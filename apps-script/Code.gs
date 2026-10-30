/**
 * Dynoz Deadlines — Google Apps Script backend
 * ------------------------------------------------------------
 * Paste this into the Google Sheet: Extensions → Apps Script.
 * Change PIN below, then Deploy → New deployment → Web app
 *   Execute as: Me      Who has access: Anyone
 * Copy the Web app URL (ends in /exec) into the app's Settings.
 *
 * Sheet layout (first tab):  Code | Task | Due | Done | ID | Added
 * "Due" is stored as plain text "YYYY-MM-DD HH:MM" so the
 * Dynoz Desk wallpaper reads it the same way.
 */

const PIN = '1234';            // <-- change this to your own PIN
const HEADER = ['Code', 'Task', 'Due', 'Done', 'ID', 'Added'];

function doGet(e)  { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return handle_(p);
}

function handle_(p) {
  if (String(p.pin || '') !== String(PIN)) return json_({ ok: false, error: 'Wrong PIN' });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_();
    switch (p.action) {
      case 'ping':   return json_({ ok: true, name: SpreadsheetApp.getActive().getName() });
      case 'list':   return json_({ ok: true, items: list_(sh) });
      case 'add':    return json_({ ok: true, item: add_(sh, p) });
      case 'update': return json_({ ok: true, item: update_(sh, p) });
      case 'delete': del_(sh, p.id); return json_({ ok: true });
      default:       return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheets()[0];
  const first = sh.getRange(1, 1, 1, HEADER.length).getValues()[0];
  const hasHeader = /^(code|kod|course)$/i.test(String(first[0]).trim());
  if (!hasHeader) {
    if (sh.getLastRow() > 0 && first.some(v => v !== '')) sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (String(first[4]).trim() === '') {
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
  }
  sh.getRange('C:C').setNumberFormat('@');   // Due as plain text
  return sh;
}

function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Kuala_Lumpur'; }

function dueText_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
  const s = String(v || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)))
    return `${m[1]}-${pad_(m[2])}-${pad_(m[3])} ${pad_(m[4] || 23)}:${m[5] || '59'}`;
  if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/))) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad_(m[2])}-${pad_(m[1])} ${pad_(m[4] || 23)}:${m[5] || '59'}`;
  }
  return s;
}
function pad_(n) { return String(n).padStart(2, '0'); }
function isDone_(v) { return v === true || /^(true|yes|ya|done|siap|✓|✔|x)$/i.test(String(v || '').trim()); }

function list_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rng = sh.getRange(2, 1, n, HEADER.length);
  const rows = rng.getValues();
  let dirty = false;
  const items = [];
  rows.forEach((r, i) => {
    if (r.slice(0, 3).every(v => v === '')) return;
    if (!r[4]) { r[4] = Utilities.getUuid().slice(0, 8); dirty = true; }
    const due = dueText_(r[2]);
    if (due !== r[2]) { r[2] = due; dirty = true; }
    if (typeof r[3] !== 'boolean') { r[3] = isDone_(r[3]); dirty = true; }
    items.push({ id: String(r[4]), code: String(r[0]), task: String(r[1]), due: due, done: r[3] });
  });
  if (dirty) rng.setValues(rows);
  return items;
}

function findRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  const ids = sh.getRange(2, 5, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function clean_(s, max) { return String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max); }

function add_(sh, p) {
  const item = {
    id: Utilities.getUuid().slice(0, 8),
    code: clean_(p.code, 20).toUpperCase(),
    task: clean_(p.task, 200),
    due: dueText_(p.due),
    done: false
  };
  if (!item.task) throw new Error('Task is empty');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.due)) throw new Error('Bad due date');
  sh.appendRow([item.code, item.task, item.due, false, item.id, new Date()]);
  return item;
}

function update_(sh, p) {
  const row = findRow_(sh, p.id);
  if (row < 0) throw new Error('Not found');
  const r = sh.getRange(row, 1, 1, 4).getValues()[0];
  if (p.code !== undefined) r[0] = clean_(p.code, 20).toUpperCase();
  if (p.task !== undefined) r[1] = clean_(p.task, 200);
  if (p.due  !== undefined) r[2] = dueText_(p.due);
  if (p.done !== undefined) r[3] = !!p.done;
  sh.getRange(row, 1, 1, 4).setValues([r]);
  return { id: String(p.id), code: r[0], task: r[1], due: r[2], done: r[3] };
}

function del_(sh, id) {
  const row = findRow_(sh, id);
  if (row > 0) sh.deleteRow(row);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
