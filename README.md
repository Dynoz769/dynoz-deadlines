# Dynoz Deadlines

A tiny phone app (PWA) for adding assignment deadlines. Everything is saved to a Google Sheet,
and the **Dynoz Desk Sync** wallpaper on the laptop reads the same sheet, so new deadlines show up
on the desktop within ~3 minutes.

- Add / edit / delete deadlines, tap the circle to mark done
- Course chips for Sem 1 2026/27 (DES3023, UPU3142, DTS3013, DEP3053, DES3013, UPU2232)
- "Next up" countdown, Overdue / Today / This week / Later groups
- Works offline: changes wait and sync when you're back online
- Installable to the home screen (Android & iPhone)

## Setup

### 1. Backend (once)
1. Open the Google Sheet → **Extensions → Apps Script**.
2. Delete what's there, paste `apps-script/Code.gs`, change `PIN` at the top, **Save**.
3. **Deploy → New deployment** → type **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Authorise, then copy the **Web app URL** (ends with `/exec`).

The sheet must stay shared as *Anyone with the link → Viewer* so the wallpaper can read it.

### 2. Host on GitHub Pages
Push this folder to a repo (e.g. `dynoz-deadlines`), then **Settings → Pages → Deploy from branch → main / root**.
The app will be at `https://dynoz769.github.io/dynoz-deadlines/`.

### 3. Phone
Open the link → tap **Enter PIN** → type your PIN → **Connect** (the `/exec` URL is already built into `app.js` as `DEFAULT_API`).
Then add it to the home screen (Chrome: ⋮ → *Add to Home screen* / *Install app*; Safari: Share → *Add to Home Screen*).

## Sheet format
`Code | Task | Due | Done | ID | Added` — Due is stored as text `YYYY-MM-DD HH:MM`.
Rows you type by hand in the sheet are picked up too (the app fills in the ID).

## Updating
If you change `Code.gs`, use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same.
If you change the app files, bump `CACHE` in `sw.js`.
