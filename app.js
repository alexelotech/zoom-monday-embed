/* =====================================================================
   CONFIG — fill these in for your board before deploying.
   Find column IDs in monday: open the board -> click a column header ->
   "..." menu doesn't show the ID directly; easiest way is to run the
   getColumnIds() helper at the bottom of this file from the browser
   console once the app is loaded inside monday, or use the monday API
   playground (https://YOURACCOUNT.monday.com/api-explorer) with:
     query { boards(ids: BOARD_ID) { columns { id title type } } }
   ===================================================================== */
const CONFIG = {
  // monday column IDs on the board this Item View is added to
  columns: {
    name: "name",              // usually the item's own name, no column needed
    parentName: "text_parent",   // <-- replace with your "Parent/Guardian" text column id
    phone: "phone_number",       // <-- replace with your "Phone" column id (type: phone)
    callLogUpdate: null,         // optional: set a text/long-text column id to also mirror the log there
  },

  // The Zoom Phone Smart Embed origin. Do not change unless Zoom's docs say otherwise.
  zoomOrigin: "https://applications.zoom.us",

  // The iframe src for Smart Embed. Get this from your Zoom Marketplace
  // "Zoom Phone Smart Embed" app install/config page after you've added
  // your hosting domain to the approved domain list.
  zoomEmbedSrc: "ZOOM_SMART_EMBED_SRC_GOES_HERE",
};

/* ===================================================================== */

const monday = window.mondaySDK ? window.mondaySDK() : (window.monday || null);
if (!monday) {
  console.error("monday-sdk-js failed to load. Check the <script> tag in index.html.");
}

let currentItemId = null;
let currentBoardId = null;
let currentPhone = null;

const el = {
  name: document.getElementById("f-name"),
  parent: document.getElementById("f-parent"),
  phone: document.getElementById("f-phone"),
  btnCall: document.getElementById("btn-call"),
  btnSms: document.getElementById("btn-sms"),
  frame: document.getElementById("zoom-frame"),
  connDot: document.getElementById("conn-dot"),
  connText: document.getElementById("conn-text"),
  banner: document.getElementById("config-banner"),
};

// Wire the real Zoom embed URL from CONFIG (kept out of the HTML so it's
// all in one place to edit).
el.frame.src = CONFIG.zoomEmbedSrc;

if (CONFIG.zoomEmbedSrc === "ZOOM_SMART_EMBED_SRC_GOES_HERE") {
  setConnStatus("err", "Zoom embed src not configured — edit CONFIG.zoomEmbedSrc in app.js");
}

/* ---------------------------------------------------------------------
   1. Get the monday item context (which item/board this is embedded on)
   --------------------------------------------------------------------- */
if (monday) {
  monday.listen("context", (res) => {
    const ctx = res.data;
    currentItemId = ctx.itemId;
    currentBoardId = ctx.boardId;
    if (currentItemId) {
      loadItemFields(currentItemId);
    }
  });

  // Also listen for settings changes if you later add a settings screen
  // that lets a board admin pick which columns map to phone/parent name.
  monday.listen("settings", (res) => {
    if (res.data && res.data.phoneColumnId) {
      CONFIG.columns.phone = res.data.phoneColumnId;
    }
  });
}

/* ---------------------------------------------------------------------
   2. Pull the item's field values via monday's GraphQL API
   --------------------------------------------------------------------- */
async function loadItemFields(itemId) {
  const wantedColumns = [CONFIG.columns.parentName, CONFIG.columns.phone].filter(Boolean);

  const query = `
    query ($itemId: [ID!], $columnIds: [String!]) {
      items (ids: $itemId) {
        name
        column_values (ids: $columnIds) {
          id
          text
          value
        }
      }
    }
  `;

  try {
    const res = await monday.api(query, {
      variables: { itemId: [String(itemId)], columnIds: wantedColumns },
    });

    const item = res.data.items[0];
    if (!item) return;

    el.name.textContent = item.name || "—";

    const findCol = (colId) =>
      item.column_values.find((c) => c.id === colId);

    const parentCol = findCol(CONFIG.columns.parentName);
    const phoneCol = findCol(CONFIG.columns.phone);

    el.parent.textContent = (parentCol && parentCol.text) || "—";

    // monday's phone column stores value as JSON like {"phone":"5552345678","countryShortName":"US"}
    let phoneDisplay = "—";
    if (phoneCol && phoneCol.text) {
      phoneDisplay = phoneCol.text;
      currentPhone = normalizePhone(phoneCol.text);
    }
    el.phone.textContent = phoneDisplay;

    const ready = Boolean(currentPhone);
    el.btnCall.disabled = !ready;
    el.btnSms.disabled = !ready;

    if (!CONFIG.columns.phone) el.banner.classList.add("show");

  } catch (err) {
    console.error("Failed to load item fields:", err);
    setConnStatus("err", "Could not read item fields — check column IDs in CONFIG");
  }
}

function normalizePhone(raw) {
  // Strip everything but digits and a leading +. Zoom expects E.164-ish input.
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // Assume US numbers if no country code given — adjust for your org.
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

/* ---------------------------------------------------------------------
   3. Click-to-call / click-to-SMS — tell the Zoom iframe what to do
   --------------------------------------------------------------------- */
el.btnCall.addEventListener("click", () => {
  if (!currentPhone) return;
  el.frame.contentWindow.postMessage(
    {
      type: "zp-make-call",
      data: { number: currentPhone, autoDial: true },
    },
    CONFIG.zoomOrigin
  );
});

el.btnSms.addEventListener("click", () => {
  if (!currentPhone) return;
  el.frame.contentWindow.postMessage(
    {
      type: "zp-input-sms",
      data: { number: currentPhone, message: "" },
    },
    CONFIG.zoomOrigin
  );
});

/* ---------------------------------------------------------------------
   4. Listen for events coming FROM the Zoom iframe
   --------------------------------------------------------------------- */
window.addEventListener("message", (event) => {
  if (event.origin !== CONFIG.zoomOrigin) return; // ignore anything not from Zoom

  const msg = event.data || {};

  switch (msg.type) {
    case "zp-ready":
    case "zp-phone-ready":
      setConnStatus("ok", "Zoom Phone connected");
      break;

    case "zp-call-log-completed-event":
      handleCallLogCompleted(msg.data);
      break;

    case "zp-error":
      setConnStatus("err", (msg.data && msg.data.message) || "Zoom Phone error");
      break;

    default:
      // Uncomment while developing to see every event Zoom sends:
      // console.log("Zoom event:", msg.type, msg.data);
      break;
  }
});

function setConnStatus(state, text) {
  el.connDot.classList.remove("ok", "err");
  if (state) el.connDot.classList.add(state);
  el.connText.textContent = text;
}

/* ---------------------------------------------------------------------
   5. Write the completed call back onto the monday item
   --------------------------------------------------------------------- */
async function handleCallLogCompleted(data) {
  if (!currentItemId || !currentBoardId) return;

  // data shape from Zoom typically includes: direction, duration, from, to,
  // result/disposition, timestamp — log the full payload during dev to confirm.
  const summary = `${data.direction || "Call"} — ${data.result || "completed"} — ${formatDuration(data.duration)}`;

  // Always add it as an Update (timeline entry) so there's a permanent log.
  const addUpdateMutation = `
    mutation ($itemId: ID!, $body: String!) {
      create_update (item_id: $itemId, body: $body) { id }
    }
  `;

  try {
    await monday.api(addUpdateMutation, {
      variables: { itemId: String(currentItemId), body: summary },
    });
  } catch (err) {
    console.error("Failed to write call log update:", err);
  }

  // Optionally also mirror it into a text/long-text column, if configured.
  if (CONFIG.columns.callLogUpdate) {
    const changeColumnMutation = `
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value (
          board_id: $boardId,
          item_id: $itemId,
          column_id: $columnId,
          value: $value
        ) { id }
      }
    `;
    try {
      await monday.api(changeColumnMutation, {
        variables: {
          boardId: String(currentBoardId),
          itemId: String(currentItemId),
          columnId: CONFIG.columns.callLogUpdate,
          value: JSON.stringify(summary),
        },
      });
    } catch (err) {
      console.error("Failed to write call log column:", err);
    }
  }
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "unknown length";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/* ---------------------------------------------------------------------
   Dev helper: run getColumnIds() in the browser console (while this app
   is loaded inside a real monday item view) to print every column's id,
   title and type for the current board, so you can fill in CONFIG above.
   --------------------------------------------------------------------- */
window.getColumnIds = async function () {
  if (!currentBoardId) {
    console.warn("No board context yet — wait for the app to load inside monday.");
    return;
  }
  const query = `query ($boardId: [ID!]) { boards (ids: $boardId) { columns { id title type } } }`;
  const res = await monday.api(query, { variables: { boardId: [String(currentBoardId)] } });
  console.table(res.data.boards[0].columns);
};
