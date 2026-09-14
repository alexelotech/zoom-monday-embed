/* =====================================================================
   CONFIG — fill these in for your board before deploying.

   Phone numbers are now auto-detected: on load, the app asks monday for
   every column on the board whose type is "phone" and reads all of them
   for the item, so this works whether a board has one phone column or
   five. You don't need to name phone columns here.

   Only these two still need manual setup:
   ===================================================================== */
const CONFIG = {
  columns: {
    parentName: "text_parent",   // <-- your "Parent/Guardian" text column id (optional — leave "" to hide that row)
    callLogUpdate: null,         // optional: a text/long-text column id to also mirror the call log into
  },

  // The Zoom Phone Smart Embed origin. Do not change unless Zoom's docs say otherwise.
  zoomOrigin: "https://applications.zoom.us",

  // Fixed Smart Embed URL from Zoom's docs — no per-account lookup needed.
  // Works once your domain (and monday.com's) is on Zoom's approved domain list.
  zoomEmbedSrc: "https://applications.zoom.us/integration/phone/embeddablephone/home",
};

/* ===================================================================== */

const monday = window.mondaySDK ? window.mondaySDK() : (window.monday || null);
if (!monday) {
  console.error("monday-sdk-js failed to load. Check the <script> tag in index.html.");
}

let currentItemId = null;
let currentBoardId = null;
let phoneColumnDefs = [];   // [{ id, title }] — every phone-type column on the board

const el = {
  name: document.getElementById("f-name"),
  parent: document.getElementById("f-parent"),
  phoneList: document.getElementById("phone-list"),
  phoneEmpty: document.getElementById("phone-empty"),
  frame: document.getElementById("zoom-frame"),
  connDot: document.getElementById("conn-dot"),
  connText: document.getElementById("conn-text"),
  banner: document.getElementById("config-banner"),
};

el.frame.src = CONFIG.zoomEmbedSrc;

/* ---------------------------------------------------------------------
   1. Get monday item context, then discover phone columns, then load data
   --------------------------------------------------------------------- */
if (monday) {
  monday.listen("context", async (res) => {
    const ctx = res.data;
    console.log("MONDAY CONTEXT:", ctx);
    currentItemId = ctx.itemId;
    currentBoardId = ctx.boardId;
    if (currentItemId && currentBoardId) {
      await discoverPhoneColumns(currentBoardId);
      await loadItemFields(currentItemId);
    }
  });
}

/* ---------------------------------------------------------------------
   2. Find every column of type "phone" on this board
   --------------------------------------------------------------------- */
async function discoverPhoneColumns(boardId) {
  const query = `
    query ($boardId: [ID!]) {
      boards (ids: $boardId) {
        columns { id title type }
      }
    }
  `;
  try {
    const res = await monday.api(query, { variables: { boardId: [String(boardId)] } });
    const columns = res.data.boards[0].columns || [];
    phoneColumnDefs = columns
      .filter((c) => c.type === "phone")
      .map((c) => ({ id: c.id, title: c.title }));

    if (phoneColumnDefs.length === 0) {
      el.phoneEmpty.textContent = "No phone-type columns found on this board.";
      el.banner.textContent = "No phone columns detected — add a Phone-type column to this board.";
      el.banner.classList.add("show");
    }
  } catch (err) {
    console.error("Failed to discover phone columns:", err);
    el.phoneEmpty.textContent = "Could not load phone columns.";
  }
}

/* ---------------------------------------------------------------------
   3. Pull the item's field values (name, parent, every phone column)
   --------------------------------------------------------------------- */
async function loadItemFields(itemId) {
  const phoneColumnIds = phoneColumnDefs.map((c) => c.id);
  const wantedColumns = [CONFIG.columns.parentName, ...phoneColumnIds].filter(Boolean);

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

    const findCol = (colId) => item.column_values.find((c) => c.id === colId);

    const parentCol = findCol(CONFIG.columns.parentName);
    el.parent.textContent = (parentCol && parentCol.text) || "—";

    renderPhoneRows(item.column_values);

  } catch (err) {
    console.error("Failed to load item fields:", err);
    setConnStatus("err", "Could not read item fields — check CONFIG");
  }
}

/* ---------------------------------------------------------------------
   4. Render one Call/Text row per phone column that has a value
   --------------------------------------------------------------------- */
function renderPhoneRows(columnValues) {
  el.phoneList.innerHTML = "";

  const rows = phoneColumnDefs
    .map((def) => {
      const col = columnValues.find((c) => c.id === def.id);
      if (!col || !col.text) return null;
      return { label: def.title, display: col.text, normalized: normalizePhone(col.text) };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    el.phoneEmpty.textContent = "No phone numbers on this item.";
    el.phoneList.appendChild(el.phoneEmpty);
    return;
  }

  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "phone-row";
    rowEl.innerHTML = `
      <div class="phone-meta">
        <span class="phone-label">${escapeHtml(row.label)}</span>
        <span class="phone-number">${escapeHtml(row.display)}</span>
      </div>
      <div class="actions">
        <button class="action btn-call">📞 Call</button>
        <button class="action secondary btn-sms">💬 Text</button>
      </div>
    `;

    rowEl.querySelector(".btn-call").addEventListener("click", () => makeCall(row.normalized));
    rowEl.querySelector(".btn-sms").addEventListener("click", () => openSms(row.normalized));

    el.phoneList.appendChild(rowEl);
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function normalizePhone(raw) {
  // Strip everything but digits and a leading +. Zoom expects E.164-ish input.
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // Assume US numbers if no country code given — adjust for your org.
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

/* ---------------------------------------------------------------------
   5. Click-to-call / click-to-SMS — tell the Zoom iframe what to do
   --------------------------------------------------------------------- */
function makeCall(number) {
  el.frame.contentWindow.postMessage(
    { type: "zp-make-call", data: { number, autoDial: true } },
    CONFIG.zoomOrigin
  );
}

function openSms(number) {
  el.frame.contentWindow.postMessage(
    { type: "zp-input-sms", data: { number, message: "" } },
    CONFIG.zoomOrigin
  );
}

/* ---------------------------------------------------------------------
   6. Listen for events coming FROM the Zoom iframe
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
   7. Write the completed call back onto the monday item
   --------------------------------------------------------------------- */
async function handleCallLogCompleted(data) {
  if (!currentItemId || !currentBoardId) return;

  const summary = `${data.direction || "Call"} — ${data.result || "completed"} — ${formatDuration(data.duration)}`;

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
   title and type for the current board.
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
