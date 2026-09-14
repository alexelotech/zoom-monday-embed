# Zoom Phone Smart Embed — monday Item View

A working prototype of the "$0 embedded softphone" idea: a monday.com **Item
View** that shows a contact's info, a Call/Text button, and an embedded Zoom
Phone Smart Embed panel — with completed calls automatically logged back onto
the monday item.

Two files, no build step:
- `index.html` — layout + the iframe that hosts Zoom's Smart Embed
- `app.js` — all the wiring: monday SDK, GraphQL reads/writes, postMessage to/from Zoom

---

## 1. Zoom-side setup

1. In the **Zoom App Marketplace**, install **Zoom Phone Smart Embed** for your account (it's free — it just exposes your existing Zoom Phone licenses over an embeddable widget).
2. In that app's configuration, add the domain you'll host this on to the **approved domain list** (e.g. `your-org.github.io` or `your-app.pages.dev`). Zoom will refuse to load the iframe on unapproved domains.
3. Copy the **embed src URL** Zoom gives you for the Smart Embed widget.
4. Open `app.js` and paste it into:
   ```js
   zoomEmbedSrc: "ZOOM_SMART_EMBED_SRC_GOES_HERE",
   ```

## 2. monday-side setup

You need the column IDs for whatever columns hold the phone number and (optionally) parent/guardian name on your board.

Easiest way to find them: deploy the app first (step 3 below), open it inside monday, then run this in the browser console:
```js
getColumnIds()
```
It prints a table of every column's `id`, `title`, and `type` for the current board. Copy the right IDs into the `CONFIG.columns` block at the top of `app.js`:

```js
const CONFIG = {
  columns: {
    parentName: "text_parent",  // your text column id
    phone: "phone_number",      // your phone column id
    callLogUpdate: null,        // optional: a text column to also mirror the log into
  },
  ...
};
```

## 3. Host it

Any static host works. Two free options:

**GitHub Pages**
```bash
git init
git add index.html app.js
git commit -m "zoom smart embed item view"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/zoom-monday-embed.git
git push -u origin main
# then enable Pages in the repo settings, root of main branch
```

**Cloudflare Pages**
```bash
npx wrangler pages deploy . --project-name=zoom-monday-embed
```

Either way you'll end up with a URL like `https://your-org.github.io/zoom-monday-embed/` — that's what you register with monday next, and what you added to Zoom's approved domains in step 1.2.

## 4. Register the monday App

1. In monday.com: **avatar → Developers → Build App → Create App**.
2. Add an **Item View** feature.
3. Set its **Custom URL** to your hosted `index.html` URL.
4. Install the app to your account, then open a board's item and add the new Item View tab.

## 5. Test it

1. Open an item that has a phone number filled in. Confirm the name/parent/phone fields populate (this proves the monday SDK context + GraphQL read is working).
2. Watch the status dot under the info panel — it should turn green ("Zoom Phone connected") once the Smart Embed iframe finishes loading and posts its ready event.
3. Click **Call** — it should trigger `zp-make-call` and Zoom's dialer should auto-dial the number.
4. Click **Text** — it should open Zoom's SMS composer pre-filled with the number.
5. Make a short test call and hang up. Check the item's **Updates** feed — you should see an auto-posted summary line (this proves the write-back mutation is working).

If the status dot stays gray or red, open the browser console — `app.js` logs every failure with context (missing config, failed GraphQL call, etc).

---

## What to extend first

Roughly in order of value for a school-office use case like the mock-up:

1. **A settings screen instead of hardcoded column IDs.** Right now `CONFIG.columns` is edited in code. monday Item Views support a `settings` context — add a small form (phone column picker, parent-name column picker) so any board admin can wire this up without touching code. The `monday.listen("settings", ...)` handler is already stubbed in `app.js` for this.
2. **Multiple phone numbers.** Real records often have a student's phone and a parent's phone, or two guardians. Add a dropdown next to Call/Text to choose which number to dial instead of assuming one column.
3. **Richer call disposition.** Zoom's `zp-call-log-completed-event` payload includes more than duration — log the actual result/direction into a status column (e.g. "Reached parent" / "No answer" / "Voicemail") instead of just a free-text Update, so you can build a monday view/filter on outreach status.
4. **SMS thread logging.** The plan mentions two-way SMS is visible in the widget itself, but nothing writes incoming/outgoing texts back to the item. If you want a permanent record, listen for Zoom's SMS events (check Zoom's Smart Embed event docs for the exact message type — it wasn't in the original spec) and post them as Updates the same way calls are logged.
5. **Multi-account distribution.** This prototype assumes one Zoom account, one monday account, hardcoded together. If this ever needs to work across multiple schools/orgs, you'd move to monday's OAuth-based app install flow (`get_token` from context) rather than a single static config.

---

## Known gaps in this prototype (worth knowing before you demo it)

- **`zoomEmbedSrc` is a placeholder.** I don't have your Zoom account's actual Smart Embed URL — Zoom hands you a specific configured URL for your account when you set up the marketplace app, and that's what goes in `CONFIG.zoomEmbedSrc`. Nothing will render in the iframe until you drop that in.
- **The exact `postMessage` event names** (`zp-make-call`, `zp-input-sms`, `zp-call-log-completed-event`) come from your original spec. I've built the plumbing around them as given, but double-check them against Zoom's current Smart Embed developer docs before you rely on this in production — Zoom does version these.
- **Phone number normalization is US-only** (`normalizePhone` in `app.js` assumes a 10-digit number is a US number). Adjust if your org dials internationally.
