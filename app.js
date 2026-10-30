/* Dynoz Deadlines — phone app for the Google Sheet that feeds the Dynoz Desk wallpaper. */
(() => {
  'use strict';

  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1TLbVO4ayDz-awQGLCIrBgnQ5wDVlAPvXgS71Vx0-Fi4/edit';
  const COURSES = ['DES3023', 'UPU3142', 'DTS3013', 'DEP3053', 'DES3013', 'UPU2232'];
  const K = { cfg: 'dd.cfg', items: 'dd.items', queue: 'dd.queue', installX: 'dd.installX', showDone: 'dd.showDone' };

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const pad = n => String(n).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const DEFAULT_API = 'https://script.google.com/macros/s/AKfycbx-u6i6bCZhv2bDPjJ0bX4GFeEB89IAGYmtTwMvLWeRptMZOYt9dzaZ-etrwpJXyxIj/exec';
  let cfg = load(K.cfg, { url: '', pin: '' });
  // URL is baked in; only the PIN has to be typed on the phone
  const savedCfg = !!cfg.pin;
  if (!cfg.url) cfg.url = DEFAULT_API;
  if (!savedCfg) cfg = { url: cfg.url, pin: '' };
  const ready = () => !!(cfg.url && cfg.pin);
  let items = load(K.items, []);
  let queue = load(K.queue, []);
  let showDone = load(K.showDone, false);
  let syncing = false, lastSync = 0, online = navigator.onLine, editing = null;

  // ================= dates =================
  function parseDue(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59) : null;
  }
  const fmtDue = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sod = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = (d, now) => Math.round((sod(d) - sod(now)) / 86400000);
  function whenLabel(d, now) {
    const ms = d - now, days = dayDiff(d, now);
    if (ms < 0) return days === 0 ? 'Overdue' : `${-days}d late`;
    if (days === 0) return ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : `${Math.round(ms / 3600000)}h left`;
    if (days === 1) return 'Tomorrow';
    if (days < 7) return DAYS[d.getDay()].slice(0, 3);
    return `${days} days`;
  }
  function dateLine(d) {
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${DAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${t === '23:59' ? '' : ' · ' + t}`;
  }

  // ================= API =================
  async function api(action, data = {}) {
    if (!ready()) throw Object.assign(new Error('Not connected'), { setup: true });
    let r;
    try {
      r = await fetch(cfg.url, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request: no CORS preflight
        body: JSON.stringify({ action, pin: cfg.pin, ...data })
      });
    } catch (e) { throw Object.assign(new Error('Offline'), { network: true }); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Bad response — check the URL and that access is "Anyone"'); }
    if (!j.ok) throw new Error(j.error || 'Server error');
    return j;
  }

  // ================= sync (offline queue) =================
  function enqueue(op) { queue.push(op); save(K.queue, queue); persist(); render(); flush(); }
  function persist() { save(K.items, items); }

  async function flush() {
    if (syncing || !ready()) return;
    syncing = true; setSync();
    try {
      while (queue.length) {
        const op = queue[0];
        try {
          if (op.action === 'add') {
            const j = await api('add', { code: op.code, task: op.task, due: op.due });
            const it = items.find(x => x.id === op.tmp);
            if (it) { it.id = j.item.id; delete it.pending; }
            queue.forEach(q => { if (q.id === op.tmp) q.id = j.item.id; });
          } else if (op.action === 'update') {
            if (String(op.id).startsWith('tmp-')) { queue.shift(); continue; }
            await api('update', op);
            const it = items.find(x => x.id === op.id); if (it) delete it.pending;
          } else if (op.action === 'delete') {
            if (!String(op.id).startsWith('tmp-')) await api('delete', { id: op.id });
          }
          queue.shift(); save(K.queue, queue); persist();
        } catch (e) {
          if (e.network) break;                       // try again later
          queue.shift(); save(K.queue, queue);        // server rejected: drop it
          toast(e.message === 'Wrong PIN' ? 'Wrong PIN — check Settings' : `Couldn't sync: ${e.message}`);
          if (e.message === 'Wrong PIN') { queue = []; save(K.queue, queue); break; }
        }
      }
      if (!queue.length) await pull();
    } finally {
      syncing = false; setSync(); render();
    }
  }

  async function pull() {
    try {
      const j = await api('list');
      items = j.items; persist(); lastSync = Date.now(); online = true;
    } catch (e) {
      if (e.network) online = false;
      else if (!e.setup) toast(e.message === 'Wrong PIN' ? 'Wrong PIN — check Settings' : e.message);
    }
  }

  async function refresh() {
    $('btnRefresh').classList.add('spin');
    if (queue.length) await flush(); else { syncing = true; setSync(); await pull(); syncing = false; setSync(); render(); }
    $('btnRefresh').classList.remove('spin');
  }

  function setSync() {
    const el = $('sync');
    el.classList.remove('warn');
    if (!ready()) el.textContent = '';
    else if (syncing) el.textContent = 'Syncing…';
    else if (queue.length) { el.textContent = `${queue.length} waiting`; el.classList.add('warn'); }
    else if (!online) { el.textContent = 'Offline'; el.classList.add('warn'); }
    else el.textContent = lastSync ? 'Synced' : '';
  }

  // ================= render =================
  function render() {
    const now = new Date();
    $('today').textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
    $('setupCard').hidden = ready();

    const all = items.map(x => ({ ...x, d: parseDue(x.due) })).filter(x => x.d).sort((a, b) => a.d - b.d);
    const open = all.filter(x => !x.done), done = all.filter(x => x.done).reverse();
    const week = open.filter(x => x.d >= now && dayDiff(x.d, now) < 7).length;
    $('today').textContent += open.length ? ` · ${week} due this week` : '';

    // hero: the next thing due
    const next = open.find(x => x.d >= now) || open[0];
    const hero = $('hero');
    if (next) {
      const ms = Math.max(0, next.d - now);
      const dd = Math.floor(ms / 86400000), hh = Math.floor(ms / 3600000) % 24, mm = Math.floor(ms / 60000) % 60;
      const late = next.d < now;
      hero.hidden = false;
      hero.className = 'hero' + (dayDiff(next.d, now) > 3 && !late ? ' calm' : '');
      hero.innerHTML = `
        <div class="k">${late ? 'Overdue' : 'Next up'}</div>
        <div class="t">${esc(next.task)}</div>
        <div class="c">${next.code ? esc(next.code) + ' · ' : ''}${dateLine(next.d)}</div>
        ${late ? '' : `<div class="cd"><div><b>${dd}</b><span>days</span></div><div><b>${hh}</b><span>hours</span></div><div><b>${pad(mm)}</b><span>min</span></div></div>`}`;
    } else hero.hidden = true;

    const groups = [
      ['Overdue', open.filter(x => x.d < now), 'overdue'],
      ['Today', open.filter(x => x.d >= now && dayDiff(x.d, now) === 0)],
      ['This week', open.filter(x => x.d >= now && dayDiff(x.d, now) >= 1 && dayDiff(x.d, now) < 7)],
      ['Later', open.filter(x => x.d >= now && dayDiff(x.d, now) >= 7)]
    ];
    let html = '';
    for (const [name, list, cls] of groups) {
      if (!list.length) continue;
      html += `<section class="group ${cls || ''}"><h3>${name}<span class="n">${list.length}</span></h3><div class="cards">${list.map(x => row(x, now)).join('')}</div></section>`;
    }
    if (!open.length) {
      html += ready() || items.length
        ? `<div class="empty"><b>All clear, Dynoz.</b>Nothing due. Tap + to add a deadline.</div>`
        : `<div class="empty"><b>No deadlines yet</b>Connect your sheet, then tap + to add one.</div>`;
    }
    if (done.length) {
      html += `<button class="toggle-done" id="toggleDone">${showDone ? 'Hide' : 'Show'} completed (${done.length})</button>`;
      if (showDone) html += `<section class="group"><div class="cards">${done.slice(0, 30).map(x => row(x, now)).join('')}</div></section>`;
    }
    $('list').innerHTML = html;
    setSync();
  }

  function row(x, now) {
    const days = dayDiff(x.d, now);
    const cls = x.done ? 'done' : (x.d < now || days <= 1) ? 'urgent' : days <= 7 ? 'soon' : '';
    return `<div class="item ${cls}${x.pending ? ' pending' : ''}" data-id="${esc(x.id)}">
      <button class="check" data-act="check" aria-label="${x.done ? 'Mark not done' : 'Mark done'}"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
      <button class="body" data-act="edit">
        <div class="t">${esc(x.task)}</div>
        <div class="m">${x.code ? `<span class="code">${esc(x.code)}</span>` : ''}<span>${dateLine(x.d)}</span></div>
      </button>
      <div class="when">${x.done ? 'Done' : whenLabel(x.d, now)}</div>
    </div>`;
  }

  // ================= actions =================
  $('list').addEventListener('click', e => {
    if (e.target.closest('#toggleDone')) { showDone = !showDone; save(K.showDone, showDone); render(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.item').dataset.id, it = items.find(x => x.id === id); if (!it) return;
    if (b.dataset.act === 'check') {
      if (!ready()) return openSettings();
      it.done = !it.done; it.pending = true;
      if (navigator.vibrate) navigator.vibrate(12);
      enqueue({ action: 'update', id, done: it.done });
      if (it.done) toast('Nice — marked done ✓');
    } else openSheet(it);
  });

  // ---------- add / edit sheet ----------
  const form = $('sheet');
  function chips() {
    const cur = $('fCode').value.trim().toUpperCase();
    $('codes').innerHTML = COURSES.map(c => `<button type="button" class="chip${c === cur ? ' on' : ''}" data-code="${c}">${c}</button>`).join('');
  }
  $('codes').addEventListener('click', e => {
    const c = e.target.closest('[data-code]'); if (!c) return;
    $('fCode').value = $('fCode').value.trim().toUpperCase() === c.dataset.code ? '' : c.dataset.code; chips();
  });
  $('fCode').addEventListener('input', chips);

  function quick() {
    const base = new Date(), opts = [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['In a week', 7], ['In 2 weeks', 14]];
    $('quick').innerHTML = opts.map(([l, n]) => { const d = new Date(base); d.setDate(d.getDate() + n); return `<button type="button" class="chip" data-date="${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}">${l}</button>`; }).join('');
    markQuick();
  }
  function markQuick() { for (const c of $('quick').children) c.classList.toggle('on', c.dataset.date === $('fDate').value); }
  $('quick').addEventListener('click', e => { const c = e.target.closest('[data-date]'); if (c) { $('fDate').value = c.dataset.date; markQuick(); } });
  $('fDate').addEventListener('input', markQuick);

  function openSheet(it) {
    if (!ready()) return openSettings();
    editing = it || null;
    $('sheetTitle').textContent = it ? 'Edit deadline' : 'New deadline';
    $('btnDelete').hidden = $('btnDoneToggle').hidden = !it;
    if (it) $('btnDoneToggle').textContent = it.done ? 'Not done' : 'Mark done';
    const d = it ? parseDue(it.due) : (() => { const t = new Date(); t.setDate(t.getDate() + 7); t.setHours(23, 59, 0, 0); return t; })();
    $('fCode').value = it ? it.code : '';
    $('fTask').value = it ? it.task : '';
    $('fDate').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('fTime').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    chips(); quick();
    show(form);
    if (!it) setTimeout(() => $('fTask').focus(), 280);
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    const code = $('fCode').value.trim().toUpperCase(), task = $('fTask').value.trim();
    const d = parseDue(`${$('fDate').value} ${$('fTime').value || '23:59'}`);
    if (!task) return $('fTask').focus();
    if (!d) return toast('Pick a date');
    const due = fmtDue(d);
    if (editing) {
      Object.assign(editing, { code, task, due, pending: true });
      enqueue({ action: 'update', id: editing.id, code, task, due });
      toast('Saved');
    } else {
      const tmp = 'tmp-' + Date.now().toString(36);
      items.push({ id: tmp, code, task, due, done: false, pending: true });
      enqueue({ action: 'add', tmp, code, task, due });
      toast(online ? 'Added — on your wallpaper in ~3 min' : 'Saved offline — will sync when online');
    }
    hide();
  });
  $('btnCancel').onclick = hide;
  $('btnDelete').onclick = () => {
    if (!editing) return;
    if (!confirm(`Delete "${editing.task}"?`)) return;
    items = items.filter(x => x !== editing);
    queue = queue.filter(q => !(q.action === 'add' && q.tmp === editing.id)); save(K.queue, queue);
    enqueue({ action: 'delete', id: editing.id });
    hide(); toast('Deleted');
  };
  $('btnDoneToggle').onclick = () => {
    if (!editing) return;
    editing.done = !editing.done; editing.pending = true;
    enqueue({ action: 'update', id: editing.id, done: editing.done });
    hide();
  };

  // ---------- settings ----------
  const sform = $('settings');
  $('lnkSheet').href = SHEET_URL;
  function openSettings() {
    $('sUrl').value = cfg.url; $('sPin').value = cfg.pin;
    $('sMsg').textContent = ''; $('sMsg').className = 'msg';
    show(sform);
    if (!cfg.pin) setTimeout(() => $('sPin').focus(), 280);
  }
  sform.addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('sUrl').value.trim(), pin = $('sPin').value.trim();
    const msg = $('sMsg');
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)) { msg.textContent = 'That doesn\'t look like an Apps Script web-app URL (…/exec).'; msg.className = 'msg err'; return; }
    if (!pin) { msg.textContent = 'Enter your PIN.'; msg.className = 'msg err'; $('sPin').focus(); return; }
    msg.textContent = 'Connecting…'; msg.className = 'msg';
    const old = cfg; cfg = { url, pin };
    try {
      const j = await api('ping');
      save(K.cfg, cfg);
      msg.textContent = `Connected to "${j.name}" ✓`; msg.className = 'msg ok';
      await pull(); render(); flush();
      setTimeout(hide, 900);
    } catch (err) {
      cfg = old;
      msg.textContent = err.network ? 'Can\'t reach it. Check the URL and your internet.' : err.message;
      msg.className = 'msg err';
    }
  });
  $('sCancel').onclick = hide;
  $('btnSettings').onclick = openSettings;
  $('btnSetup').onclick = openSettings;
  $('btnRefresh').onclick = refresh;
  $('fab').onclick = () => openSheet(null);

  // ---------- sheet helpers ----------
  function show(el) { form.hidden = sform.hidden = true; $('scrim').hidden = false; el.hidden = false; }
  function hide() { $('scrim').hidden = true; form.hidden = true; sform.hidden = true; editing = null; }
  $('scrim').onclick = hide;
  addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });

  let tt;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 2600); }

  // ---------- install to home screen ----------
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let deferred = null;
  function installBanner() {
    if (standalone || load(K.installX, false)) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $('installHow').textContent = deferred ? 'Opens like a normal app, works offline.' : ios ? 'Tap Share ↑ then "Add to Home Screen".' : 'Browser menu ⋮ → "Add to Home screen".';
    $('btnInstall').hidden = !deferred;
    $('install').hidden = false;
  }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; installBanner(); });
  $('btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('install').hidden = true; };
  $('btnInstallX').onclick = () => { save(K.installX, true); $('install').hidden = true; };

  // ---------- lifecycle ----------
  addEventListener('online', () => { online = true; flush(); });
  addEventListener('offline', () => { online = false; setSync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastSync > 30000) refresh(); });
  setInterval(render, 30000);
  setInterval(() => { if (queue.length) flush(); }, 30000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  window.__dd = { get cfg() { return cfg; }, get items() { return items; }, get queue() { return queue; } };
  render();
  setTimeout(installBanner, 1200);
  if (ready()) flush();
  if (new URLSearchParams(location.search).has('add')) { history.replaceState(null, '', location.pathname); openSheet(null); }
})();
