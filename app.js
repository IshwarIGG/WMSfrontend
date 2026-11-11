// SignupAlphaGrow WMS - plain HTML/JS front end. All business logic is in core.js (WMS).
const W = WMS;
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const label = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const cls = { Normal: 'ok', Warning: 'wa', Critical: 'er' };
const ICONS = {
  dash: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  wh: '<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-8h6v8"/>', grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  up: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-4-5.6"/>', bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
Object.assign(ICONS, { alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>', gauge: '<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>' });
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

// ---------- theme (auto / light / dark) ----------
let theme = (() => { try { return localStorage.getItem('wms-theme') || 'auto'; } catch (e) { return 'auto'; } })();
const isDark = () => theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
function applyTheme() { const r = document.documentElement; if (theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = theme; }
applyTheme();

let flashes = [];            // messages shown once on the next render
const LS = {};               // per-list search / filter / page state
const flashHtml = () => flashes.map((f) => `<div class="msg ${esc(f.level)}">${esc(f.msg)}</div>`).join('');

// ---------- routing ----------
function route() { const [page, qs = ''] = location.hash.replace(/^#\/?/, '').split('?'); return { page: page || 'dashboard', q: Object.fromEntries(new URLSearchParams(qs)) }; }
function go(page, q = {}) { const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString(), h = '#/' + page + (qs ? '?' + qs : ''); if (location.hash === h) render(); else location.hash = h; }
window.addEventListener('hashchange', render);

// ---------- charts (dashboard) ----------
const hbars = (items) => !items.length ? '<p class="muted">No data yet.</p>' : `<div class="hb">${items.map(([l, x, d, c]) => `<div><span title="${esc(l)}">${esc(l)}</span><i><u class="${c}" style="width:${x > 0 ? Math.max(2, Math.round(x / Math.max(1, ...items.map((i) => i[1])) * 100)) : 0}%"></u></i><em>${esc(d)}</em></div>`).join('')}</div>`;
const donut = (pct, st) => { const c = 2 * Math.PI * 45; return `<svg viewBox="0 0 120 120" class="donut ${st}"><circle cx="60" cy="60" r="45" class="bg"/><circle cx="60" cy="60" r="45" class="fg" stroke-dasharray="${(c * pct / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 60 60)"/><text x="60" y="67" text-anchor="middle">${Math.round(pct)}%</text></svg>`; };
const stack = (parts) => { const t = Math.max(1, parts.reduce((a, p) => a + p[1], 0)); return `<div class="stack">${parts.map(([n, x, c]) => `<u class="${c}" style="width:${(x / t * 100).toFixed(2)}%" title="${esc(n)}"></u>`).join('')}</div><div class="legend">${parts.map(([n, x, c]) => `<span><s class="${c}"></s>${esc(n)} <b>${fmt(x)}</b></span>`).join('')}</div>`; };
const cell = (c, v) => { const b = W.badge(c, v); return b ? `<span class="tag ${b}">${esc(v)}</span>` : esc(v); };
const table = (rows, cols, empty = 'No records yet.') => !rows.length ? `<p class="muted">${esc(empty)}</p>` : `<div class="tw"><table><tr>${cols.map((c) => `<th>${esc(label(c))}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(c, r[c])}</td>`).join('')}</tr>`).join('')}</table></div>`;
const plainTable = (rows) => table(rows, rows[0] ? Object.keys(rows[0]) : []);

function whBar(page, c, q, extra) {
  const sel = (name, map, cur) => `<select data-bar="${name}">${Object.entries(map).map(([k, l]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="bar"><label>Warehouse${sel('wh', W.whMap(c), c.wh)}</label>${extra ? `<label>Product${sel('prod', W.prodMap(c), c.prod ? c.prod.product_id : '')}</label>` : ''}</div>`;
}

function dashboard(page, q) {
  const c = W.ctxFor(q);
  if (!c.whs.length) return `<div class="card empty"><h2>Welcome 👋</h2><p class="muted">Start by registering your first warehouse.</p>${W.canWrite('warehouse') ? '<a class="btn" href="#/warehouse">Add warehouse</a>' : ''}</div>`;
  const d = W.dash(c.wh), w = d.w, info = d.info, util = w.util, st = W.statusOf(util), sc = cls[st], inv = d.inv, buf = w.pos * w.safety_buffer / 100, avail = Math.max(w.op - w.pal, 0), risk = inv.dq + inv.qq;
  const kp = [['Utilization', fmt(util, 1) + '%', st, sc, 'gauge'], ['Operating capacity', fmt(w.op), `${fmt(w.pos)} positions − ${fmt(buf)} buffer`, 'b1', 'grid'], ['Current pallets', fmt(w.pal, 1), 'entered in inventory', 'b2', 'layers'], ['Available capacity', fmt(avail), 'free pallet positions', 'b3', 'box'],
    ['Products', fmt(d.products), 'in ' + c.wh, 'b4', 'box'], ['Available units', fmt(inv.aq), `of ${fmt(inv.cq)} on hand`, 'b1', 'layers'], ['At-risk units', fmt(risk), 'damaged + quarantine', risk > 0 ? 'wa' : 'ok', 'alert'], ['Unread alerts', String(W.unreadCount()), 'open notifications', 'b2', 'bell']];
  const SC = [['warehouse', 'Add warehouse', 'wh'], ['storage', 'Generate storage', 'grid'], ['product', 'Add product / batch', 'box'], ['inventory', 'Receive inventory', 'layers'], ['returns', 'Record return', 'undo'], ['import', 'Import CSV', 'up']];
  return whBar('dashboard', c, q) +
    (w.pos === 0 ? '<div class="msg warn">No storage structure generated for this warehouse yet.</div>' : '') +
    (w.op > 0 && w.pal > w.op ? `<div class="msg err">Overfilled: entered pallets (${fmt(w.pal)}) exceed operating capacity (${fmt(w.op)}).</div>` : '') +
    `<section class="hero ${sc}"><div><span class="eyebrow">Warehouse overview</span><h2>${esc(info.warehouse_name)}</h2><p>${esc(c.wh)} · ${esc(info.warehouse_type)} · ${esc(info.location)}</p><span class="pill">${st} · ${fmt(util, 1)}% utilized</span></div>${donut(util, st)}</section>
    <div class="quick">${SC.filter(([p]) => W.canWrite(p)).map(([p, l, ic]) => `<a class="btn ghost" href="#/${p}?wh=${esc(c.wh)}">${icon(ic)}${esc(l)}</a>`).join('')}</div>
    <div class="grid kpis">${kp.map(([l, x, s, k, ic]) => `<div class="kpi ${k}"><i class="kic">${icon(ic)}</i><div><span>${esc(l)}</span><b>${esc(x)}</b><small>${esc(s)}</small></div></div>`).join('')}</div>
    <div class="meter ${sc}"><i style="width:${util.toFixed(1)}%"></i></div>
    <div class="cols">
      <div class="card"><h3>Capacity utilization</h3><div class="dn">${donut(util, st)}<div><p><b>${fmt(w.pal, 1)}</b> of <b>${fmt(w.op)}</b> operating pallets used</p><p class="muted">Safety buffer ${w.safety_buffer}% · thresholds 70% / 85%</p></div></div></div>
      <div class="card"><h3>Stock status (units)</h3>${stack([['Available', inv.aq, 'ok'], ['Reserved', inv.rq, 'b1'], ['Damaged', inv.dq, 'er'], ['Quarantine', inv.qq, 'wa']])}</div>
      <div class="card"><h3>Top products by stock</h3>${hbars(d.top.map(([l, v]) => [l, v, fmt(v), 'b1']))}</div>
      <div class="card"><h3>Utilization by warehouse</h3>${hbars(d.all.map((x) => [`${x.id} ${x.name}`, x.util, Math.round(x.util) + '%', cls[W.statusOf(x.util)]]))}</div>
      <div class="card"><h3>Returns, last 30 days (units)</h3>${hbars(d.returns.map(([l, v]) => [l, v, fmt(v), 'b2']))}</div></div>
    <h2>Expiring within 30 days</h2>${plainTable(d.expiring)}<h2>Recent inventory</h2>${plainTable(d.recent)}`;
}

// ---------- generic form ----------
function fieldHtml(f, c) {
  const attrs = ['required', 'maxlength', 'min', 'step', 'placeholder', 'accept'].filter((k) => f[k] !== undefined).map((k) => (k === 'required' ? 'required' : `${k}="${esc(f[k])}"`)).join(' ');
  const def = f.def ? f.def(c) : '';
  if (f.disabled) return `<label>${esc(f.label)}<input value="${esc(f.value ? f.value(c) : '')}" disabled></label>`;
  if (f.type === 'select') return `<label>${esc(f.label)}<select name="${f.name}">${Object.entries(f.options(c)).map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(def) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `<label>${esc(f.label)}<input name="${f.name}" type="${f.type}" ${attrs} value="${esc(def)}"${f.calc ? ' data-n' : ''}></label>`;
}
function formHtml(id, c, page) {
  const F = W.FORMS[id], blocked = F.blocked && F.blocked(c);
  if (blocked) return `<div class="msg warn">${esc(blocked)}</div>`;
  const fields = F.fields.map((f) => fieldHtml({ ...f, calc: F.calc && F.calc.includes(f.name) }, c)).join(''), note = F.note ? F.note(c) : '';
  return `<form class="f" data-form="${id}"><div class="grid">${fields}</div>${F.calc ? `<p class="muted">${esc(F.calcLabel)}: <b data-total>1</b></p>` : ''}${note ? `<p class="muted">${esc(note)}</p>` : ''}<button>${esc(F.submit)}</button></form>`;
}

// ---------- generic list (search / filters / pagination) ----------
function listHtml(id, c, render) {
  const st = (LS[id] ||= { q: '', f: {}, n: '', p: 1 }), r = W.listQuery(id, st, c), filters = W.listFilters(id, c);
  const sel = (name, o, cur, lab) => `<select name="${name}" aria-label="${esc(lab)}"><option value="">${esc(lab)}: All</option>${Object.entries(o).map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const bar = `<form class="fbar" data-list="${id}">${W.hasSearch(id) ? `<input type="search" name="q" placeholder="Search…" maxlength="100" value="${esc(st.q)}">` : ''}${filters.map((f) => sel('f_' + f.key, f.opts, st.f[f.key], f.label)).join('')}
    <select name="n" aria-label="Rows per page">${[10, 15, 25, 50, 100].map((n) => `<option value="${n}"${n === r.n ? ' selected' : ''}>${n} / page</option>`).join('')}</select><button>Apply</button>${r.active ? `<a class="btn ghost" href="#" data-reset="${id}">Reset</a>` : ''}</form>`;
  let body;
  if (!r.rows.length) body = `<p class="muted">${r.active ? 'No matching records.' : 'No records yet.'}</p>`;
  else if (render === 'users') body = `<div class="tw"><table><tr><th>User</th><th>Name</th><th>Role</th><th>Active</th><th>New password</th><th></th></tr>${r.rows.map((u) => `<tr data-uid="${u.id}"><td>${esc(u.username)}</td><td>${esc(u.full_name)}</td><td><select name="role">${W.ROLES.map((x) => `<option${x === u.role ? ' selected' : ''}>${x}</option>`).join('')}</select></td><td><input type="checkbox" name="active"${u.active ? ' checked' : ''}></td><td><input type="password" name="password" placeholder="leave blank to keep" autocomplete="new-password"></td><td><button data-usave="${u.id}" style="margin:0;padding:6px 12px">Save</button></td></tr>`).join('')}</table></div>`;
  else if (render === 'notif') body = `<div class="card nl">${r.rows.map((n) => `<a href="#" data-open="${n.id}" class="ni${n.rd ? '' : ' un'}"><s class="lv ${esc(n.level)}"></s><span>${esc(n.message)}<small>${esc(n._ago)} · ${esc(n._ts)}</small></span></a>`).join('')}</div>`;
  else body = table(r.rows, r.cols);
  let pager = '';
  if (r.total) {
    const link = (i, l) => `<a class="pg" href="#" data-page="${id}:${i}">${l}</a>`, ps = [...new Set([1, r.page - 2, r.page - 1, r.page, r.page + 1, r.page + 2, r.pages].filter((i) => i >= 1 && i <= r.pages))].sort((a, b) => a - b);
    let last = 0, mid = '';
    ps.forEach((i) => { if (last && i - last > 1) mid += '<span class="pg dis">…</span>'; mid += i === r.page ? `<span class="pg on">${i}</span>` : link(i, i); last = i; });
    pager = `<div class="pager"><span class="muted">Showing ${fmt((r.page - 1) * r.n + 1)}–${fmt(Math.min(r.page * r.n, r.total))} of ${fmt(r.total)}</span><span class="pgs">${r.page > 1 ? link(r.page - 1, '‹ Prev') : '<span class="pg dis">‹ Prev</span>'}${mid}${r.page < r.pages ? link(r.page + 1, 'Next ›') : '<span class="pg dis">Next ›</span>'}</span></div>`;
  }
  return bar + body + pager;
}

// ---------- page + shell ----------
function pageHtml(page, q) {
  const pg = W.PAGES[page], c = W.ctxFor(q);
  if (page === 'dashboard') return dashboard(page, q);
  if (pg.needsWh && !c.whs.length) return '<div class="msg warn">Please <a href="#/warehouse">add a warehouse</a> first.</div>';
  return pg.blocks.map((b) => {
    if (b.t === 'form') return formHtml(b.id, c, page);
    if (b.t === 'h2') return `<h2>${esc(W.txt(b.x, c))}</h2>`;
    if (b.t === 'list') return listHtml(b.id, c, b.render);
    if (b.t === 'table') return plainTable(b.fn());
    if (b.t === 'bar') return whBar(page, c, q, b.prod);
    if (b.t === 'invbar') return c.invs.length ? `<div class="bar"><label>Inventory record<select data-bar="inv">${c.invs.map((i) => `<option value="${i.inventory_id}"${c.inv && i.inventory_id === c.inv.inventory_id ? ' selected' : ''}>${esc(`${i.inventory_id} · ${i.warehouse_id} · ${i.product_id} · ${i.child_batch_id}`)}</option>`).join('')}</select></label></div>` : '';
    if (b.t === 'msg') return `<div class="msg">${esc(b.x)}</div>`;
    if (b.t === 'markAll') return '<div class="bar"><button data-markall style="margin:0">Mark all as read</button></div>';
    if (b.t === 'help') return W.importHelp().map(([k, v]) => `<p><b>${esc(k)}:</b> <span class="muted">${esc(v)}</span></p>`).join('');
    return '';
  }).join('');
}
function render() {
  const { page, q } = route(), app = $('#app');
  if (!W.me()) { document.body.className = 'auth2'; app.innerHTML = authHtml(page === 'signup' ? 'signup' : 'login'); flashes = []; return; }
  if (page === 'login' || page === 'signup' || !W.PAGES[page]) return go('dashboard');
  W.scanAlerts();
  const u = W.me(), pg = W.PAGES[page], ro = !W.canWrite(page), unread = W.unreadCount();
  document.body.className = ro ? 'ro' : '';
  const nav = Object.entries(W.NAV).map(([g, ls]) => { const v = ls.filter(([p]) => W.canView(p)); return v.length ? `<div class="grp">${esc(g)}</div>${v.map(([p, l, ic]) => `<a href="#/${p}"${p === page ? ' class="on"' : ''}>${icon(ic)}${esc(l)}</a>`).join('')}` : ''; }).join('');
  const items = W.recentNotifications();
  const content = !W.canView(page) ? '<div class="msg err">Your role cannot open this page.</div>' : (ro && page !== 'dashboard' ? `<div class="msg warn">Read-only: your role (${esc(u.role)}) cannot change data on this page.</div>` : '') + '<div id="flash">' + flashHtml() + '</div>' + pageHtml(page, q);
  app.innerHTML = `<aside class="sb"><div class="brand"><span class="logo">S</span>Signup<b>AlphaGrow</b></div>${nav}<div class="me"><span class="av">${esc(u.full_name[0].toUpperCase())}</span><div><b>${esc(u.full_name)}</b><small>${esc(u.role)}</small></div></div></aside>
  <div class="shell"><header class="top"><button class="ib mt" data-menu aria-label="Menu">${icon('menu')}</button><span class="crumb">${W.APP} <i>/</i> <b>${esc(pg.title)}</b></span><span class="sp"></span><button class="ib" data-theme-toggle aria-label="Toggle dark mode" title="Toggle dark mode">${icon(isDark() ? 'sun' : 'moon')}</button>
    <details class="dd"><summary class="ib" aria-label="Notifications">${icon('bell')}${unread ? `<em class="badge">${Math.min(unread, 99)}</em>` : ''}</summary><div class="menu"><div class="mh">Notifications</div>${items.map((n) => `<a href="#" data-open="${n.id}" class="ni${n.rd ? '' : ' un'}"><s class="lv ${esc(n.level)}"></s><span>${esc(n.message)}<small>${esc(n.ago)}</small></span></a>`).join('') || '<p class="muted pad">You are all caught up.</p>'}<a class="mf" href="#/notifications">View all notifications</a></div></details>
    <details class="dd"><summary class="chip">${esc(u.username)} <span class="role r-${esc(u.role)}">${esc(u.role)}</span></summary><div class="menu sm"><button class="lo" data-logout>Sign out</button></div></details></header>
    <main><div class="ph"><h1>${esc(pg.title)}</h1><p class="sub">${esc(pg.sub)}</p></div>${content}</main></div>`;
  flashes = [];
}
function authHtml(mode) {
  const feat = ['Live capacity analytics: utilization, safety buffers and Normal / Warning / Critical status', 'Storage structure generator for up to 200,000 pallet positions per warehouse', 'Batch tracking with parent / child IDs and automatic expiry alerts', 'Inventory control: reserved, damaged and quarantine stock with returns workflow', 'Role-based access for admins, managers, operators and viewers', 'Search, filters, pagination and CSV bulk import on every list'];
  const su = mode === 'signup', f = (n, l, t = 'text', extra = '') => `<label>${l}<input name="${n}" type="${t}" required ${extra}></label>`;
  return `<section class="pane"><div class="brand"><span class="logo">S</span>Signup<b>AlphaGrow</b></div><h1>Run your warehouse with clarity</h1><p>${W.APP} is a warehouse management system that turns floor space, stock and team activity into one live picture, so you know what you hold, where it sits and what needs attention.</p>
    <div class="stats"><div><b>${W.MODULES.length}</b><span>Modules</span></div><div><b>4</b><span>Access roles</span></div><div><b>200K</b><span>Positions / warehouse</span></div></div><ul class="feat">${feat.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="chips">${W.MODULES.map((m) => `<span>${esc(m[0])}</span>`).join('')}</div></section>
  <section class="formside"><div class="card"><h2>${su ? 'Create your account' : 'Welcome back'}</h2><p class="sub">${su ? 'New accounts start with read-only viewer access.' : 'Sign in to your ' + W.APP + ' workspace.'}</p>${flashHtml()}
    <form data-auth="${mode}">${su ? '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' + f('name', 'Full name', 'text', 'maxlength="100"') : ''}${f('username', 'Username', 'text', 'autocomplete="username"')}${f('password', su ? 'Password (10+ characters)' : 'Password', 'password')}${su ? f('password2', 'Confirm password', 'password') : ''}
    <button style="justify-content:center">${su ? 'Create account' : 'Sign in'}</button></form>
    <p class="alt">${su ? 'Already have an account? <a href="#/login">Sign in</a>' : 'New here? <a href="#/signup">Create an account</a>'}</p>${su ? '' : '<p class="alt">Demo logins: admin, manager, operator, viewer · password Demo@12345!</p>'}</div></section>`;
}

// ---------- events ----------
const showFlash = () => { const el = $('#flash'); if (el) el.innerHTML = flashHtml(); };
const setFlash = (r) => { flashes = [{ level: r.ok ? 'ok' : r.level || 'err', msg: r.msg }, ...(r.extra || [])].filter((f) => f.msg); };
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.dd[open]').forEach((d) => d.contains(e.target) || d.removeAttribute('open'));
  const t = e.target.closest('[data-open],[data-page],[data-reset],[data-usave],[data-markall],[data-logout],[data-menu],[data-theme-toggle]'); if (!t) return;
  const d = t.dataset;
  if (d.open) { e.preventDefault(); const l = W.openNotification(+d.open); const [p, qs] = (l || 'notifications').split('?'); go(p, Object.fromEntries(new URLSearchParams(qs || ''))); }
  else if (d.page) { e.preventDefault(); const [id, p] = d.page.split(':'); LS[id].p = +p; render(); }
  else if (d.reset) { e.preventDefault(); LS[d.reset] = { q: '', f: {}, n: '', p: 1 }; render(); }
  else if (d.usave) { const tr = t.closest('tr'); setFlash(W.editUser(+d.usave, { role: tr.querySelector('[name=role]').value, active: tr.querySelector('[name=active]').checked, password: tr.querySelector('[name=password]').value })); render(); }
  else if ('markall' in d) { setFlash(W.markAllRead()); render(); }
  else if ('logout' in d) { W.logout(); go('login'); }
  else if ('themeToggle' in d) { theme = isDark() ? 'light' : 'dark'; try { localStorage.setItem('wms-theme', theme); } catch (e) {} applyTheme(); render(); }
  else if ('menu' in d) document.body.classList.toggle('nav');
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.bar) { const { page, q } = route(); const nq = { ...q, [el.dataset.bar]: el.value }; if (el.dataset.bar === 'wh') delete nq.prod; go(page, nq); }
  else if (el.closest('form[data-list]') && el.tagName === 'SELECT') el.closest('form').requestSubmit();
});
document.addEventListener('input', (e) => {
  const form = e.target.closest('form[data-form]'); if (!form) return;
  const tot = form.querySelector('[data-total]'); if (tot) tot.textContent = [...form.querySelectorAll('[data-n]')].reduce((a, i) => a * (+i.value || 0), 1).toLocaleString('en-US');
});
document.addEventListener('submit', async (e) => {
  const form = e.target; e.preventDefault();
  if (form.dataset.auth) {
    const v = Object.fromEntries(new FormData(form));
    const r = form.dataset.auth === 'login' ? W.login(v.username, v.password) : W.signup(v);
    if (form.dataset.auth === 'login' && r.ok) return go('dashboard');
    setFlash(r); if (form.dataset.auth === 'signup' && r.ok) return go('login'); return render();
  }
  if (form.dataset.list) {
    const id = form.dataset.list, v = Object.fromEntries(new FormData(form)), f = {};
    Object.keys(v).forEach((k) => { if (k.startsWith('f_')) f[k.slice(2)] = v[k]; });
    LS[id] = { q: v.q || '', f, n: v.n, p: 1 }; return render();
  }
  if (form.dataset.form) {
    const F = W.FORMS[form.dataset.form], v = {};
    for (const f of F.fields) { if (f.disabled) continue; const el = form.querySelector(`[name="${f.name}"]`); v[f.name] = f.type === 'file' ? (el.files[0] ? { name: el.files[0].name, text: await el.files[0].text() } : null) : el.value; }
    const r = F.run(v, W.ctxFor(route().q)); setFlash(r);
    if (r.ok || r.level === 'warn') render(); else showFlash();
  }
});
if (!location.hash) location.hash = '#/dashboard';
render();
