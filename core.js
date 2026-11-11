// SignupAlphaGrow WMS - shared business logic (port of lib.php + page handlers). Framework independent.
// Data lives in memory (resets on refresh). Replace the db object + actions with fetch() calls to a real API later.
const WMS = (() => {
  'use strict';
  const APP = 'SignupAlphaGrow';
  const ROLES = ['admin', 'manager', 'operator', 'viewer'];
  const MODULES = [['Dashboard', 'KPIs, charts and quick actions'], ['Warehouse', 'Register and manage sites'], ['Storage', 'Generate and browse pallet locations'], ['Product & Batch', 'Catalogue and batch tracking'], ['Inventory', 'Stock, reserved, damaged, quarantine'], ['Returns', 'Return workflow with eligibility rules'], ['Data Import', 'Bulk CSV upload'], ['Users & Roles', 'Team access control (RBAC)'], ['Notifications', 'Capacity, expiry and return alerts']];
  const SIGNUP_MODE = 'approval'; // 'approval' | 'open' | 'off'
  // page => [view roles, write roles]; '*' = every signed-in role
  const ACL = { dashboard: ['*', []], warehouse: ['*', ['admin', 'manager']], storage: ['*', ['admin', 'manager']], product: ['*', ['admin', 'manager']], inventory: ['*', ['admin', 'manager', 'operator']], returns: ['*', ['admin', 'manager', 'operator']], import: [['admin', 'manager'], ['admin', 'manager']], users: [['admin'], ['admin']], notifications: ['*', '*'] };
  const NAV = { Overview: [['dashboard', 'Dashboard', 'dash']], Setup: [['warehouse', 'Warehouse', 'wh'], ['storage', 'Storage', 'grid'], ['product', 'Product & Batch', 'box']], Operations: [['inventory', 'Inventory', 'layers'], ['returns', 'Returns', 'undo'], ['import', 'Data Import', 'up']], Admin: [['users', 'Users & Roles', 'users']] };

  // ---------- helpers ----------
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = () => iso(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(new Date(s + 'T00:00:00Z')) === s;
  const str = (v) => String(v ?? '').trim();
  const pint = (v, min = 0) => { const x = str(v); return /^\d+$/.test(x) && +x >= min ? +x : null; };
  const pnum = (v, min = 0) => { const x = str(v); return x !== '' && isFinite(+x) && +x >= min ? +x : null; };
  const pint0 = (v) => (str(v) === '' ? 0 : pint(v));
  const pnum0 = (v) => (str(v) === '' ? 0 : pnum(v));
  const ok = (msg) => ({ ok: true, msg });
  const err = (msg) => ({ ok: false, msg });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const nextId = (list, key, pre, w) => { let n = 0; for (const r of list) { const s = String(r[key]); if (s.startsWith(pre)) { const k = parseInt(s.slice(pre.length), 10); if (k > n) n = k; } } return pre + String(n + 1).padStart(w, '0'); };
  const whCode = (n) => { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
  const statusOf = (u) => (u < 70 ? 'Normal' : u < 85 ? 'Warning' : 'Critical');
  const ago = (ts) => { const d = Math.max((Date.now() - ts) / 1000, 0); return d < 3600 ? Math.max(Math.floor(d / 60), 1) + 'm ago' : d < 86400 ? Math.floor(d / 3600) + 'h ago' : Math.floor(d / 86400) + 'd ago'; };
  const fmtTs = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  const opts = (arr) => Object.fromEntries(arr.map((x) => [x, x]));

  // ---------- in-memory database ----------
  const db = { warehouses: [], storage: [], products: [], batches: [], inventory: [], returns: [], users: [], notifications: [], reads: [] };
  const S = { uid: null, scanAt: 0, su: [] };

  function genStorage(id, n) {
    const rows = [], p = (x, w) => String(x).padStart(w, '0');
    for (let z = 1; z <= n.zones; z++) for (let a = 1; a <= n.aisles; a++) for (let r = 1; r <= n.racks; r++) for (let l = 1; l <= n.levels; l++) for (let b = 1; b <= n.bins; b++) for (let s = 1; s <= n.positions; s++) {
      const Z = 'Z' + p(z, 2), A = 'A' + p(a, 2), R = 'R' + p(r, 2), L = 'L' + p(l, 2), B = 'B' + p(b, 3), P = 'P' + p(s, 2);
      rows.push({ warehouse_id: id, zone: Z, aisle: A, rack: R, lvl: L, bin_no: B, pallet_position: P, storage_location_id: `${Z}-${A}-${R}-${L}-${B}-${P}` });
    }
    return rows;
  }
  function createBatch(wh, pid, expiry) {
    const W = db.warehouses.find((w) => w.warehouse_id === wh);
    let n = 0; for (const b of db.batches) n = Math.max(n, parseInt(b.parent_batch_id.slice(3), 10) || 0);
    const par = 'B' + String(new Date().getFullYear()).slice(2) + String(n + 1).padStart(6, '0'), child = par + W.region + W.warehouse_code;
    if (db.batches.some((b) => b.child_batch_id === child)) return null;
    const b = { parent_batch_id: par, child_batch_id: child, warehouse_id: wh, region: W.region, warehouse_code: W.warehouse_code, product_id: pid, expiry: expiry || null };
    db.batches.push(b); return b;
  }
  function putInventory(wh, P, child, loc, mdate, res, dam, qua, pal, wt, updatedAt) {
    const cur = P.pack_size * P.case_size * P.pallet_size, av = cur - res - dam - qua, cc = Math.floor(cur / P.case_size);
    const b = db.batches.find((x) => x.child_batch_id === child);
    let r = db.inventory.find((i) => i.child_batch_id === child && i.warehouse_id === wh && i.product_id === P.product_id && i.manufacturing_date === mdate && i.net_content === P.net_content);
    const vals = { parent_batch_id: b.parent_batch_id, storage_location_id: loc, inventory_weight: wt, current_quantity: cur, reserved_quantity: res, available_quantity: av, damaged_quantity: dam, quarantine_quantity: qua, case_count: cc, current_pallets: pal, updated_at: updatedAt || Date.now() };
    if (r) { Object.assign(r, vals); return { r, msg: `Inventory ${r.inventory_id} updated.` }; }
    r = { inventory_id: nextId(db.inventory, 'inventory_id', 'INV', 7), child_batch_id: child, warehouse_id: wh, product_id: P.product_id, manufacturing_date: mdate, net_content: P.net_content, ...vals };
    db.inventory.push(r); return { r, msg: `Inventory ${r.inventory_id} saved.` };
  }
  function seed() {
    [['WH001', 'N', 'A', 'North Hub DC', 'Ambient', 'Delhi NCR', 220, 110, 32, 600000, 10, { zones: 5, aisles: 4, racks: 5, levels: 3, bins: 2, positions: 1 }],
     ['WH002', 'E', 'B', 'East Cold Store', 'Chilled', 'Kolkata', 150, 80, 25, 250000, 15, { zones: 4, aisles: 5, racks: 5, levels: 2, bins: 2, positions: 1 }],
     ['WH003', 'N', 'C', 'Central DC', 'Ambient', 'Nagpur', 200, 100, 30, 500000, 10, { zones: 3, aisles: 5, racks: 5, levels: 2, bins: 2, positions: 1 }]].forEach((w) => {
      db.warehouses.push({ warehouse_id: w[0], region: w[1], warehouse_code: w[2], warehouse_name: w[3], warehouse_type: w[4], location: w[5], length_ft: w[6], width_ft: w[7], height_ft: w[8], weight_capacity: w[9], total_area: w[6] * w[7], safety_buffer: w[10] });
      db.storage.push(...genStorage(w[0], w[11]));
    });
    [['P0001', 'WH001', 'Orange Juice', 'Beverages', '10 × 6 × 4', 50, '500 ml', 6, 4, 50, '40 boxes per pallet', '15-25 °C'], ['P0002', 'WH001', 'Basmati Rice', 'Grocery', '30 × 20 × 8', 40, '5 kg', 4, 5, 40, '8 cases per layer', 'Ambient'],
     ['P0003', 'WH001', 'Sunflower Oil', 'Grocery', '25 × 18 × 12', 30, '1 L', 12, 2, 30, '6 cases per layer', 'Below 30 °C'], ['P0008', 'WH001', 'Mineral Water', 'Beverages', '28 × 18 × 22', 45, '1 L', 12, 2, 45, '6 cases per layer', 'Ambient'],
     ['P0005', 'WH002', 'Greek Yogurt', 'Dairy', '20 × 15 × 10', 60, '400 g', 6, 4, 60, '10 cases per layer', '2-6 °C'], ['P0006', 'WH002', 'Cheddar Cheese', 'Dairy', '22 × 14 × 9', 40, '200 g', 10, 3, 40, '8 cases per layer', '2-6 °C'],
     ['P0007', 'WH002', 'Frozen Peas', 'Frozen', '24 × 16 × 10', 50, '1 kg', 8, 3, 50, '10 cases per layer', '-18 °C'], ['P0001', 'WH003', 'Orange Juice', 'Beverages', '10 × 6 × 4', 50, '500 ml', 6, 4, 50, '40 boxes per pallet', '15-25 °C']]
      .forEach((p) => db.products.push({ product_id: p[0], warehouse_id: p[1], product_name: p[2], category: p[3], dimensions: p[4], units_per_pallet: p[5], net_content: p[6], pack_size: p[7], case_size: p[8], pallet_size: p[9], pallet_configuration: p[10], temperature_requirement: p[11] }));
    const b = (wh, pid, d) => createBatch(wh, pid, addDays(d)).child_batch_id;
    const c1 = b('WH001', 'P0001', 9), c2 = b('WH001', 'P0002', 200), c3 = b('WH001', 'P0003', 365), c4 = b('WH001', 'P0008', 25), c5 = b('WH002', 'P0005', 14), c6 = b('WH002', 'P0006', 60), c7 = b('WH002', 'P0007', 300), c8 = b('WH003', 'P0001', 120);
    const P = (wh, pid) => db.products.find((p) => p.warehouse_id === wh && p.product_id === pid), L = (wh, k) => db.storage.filter((s) => s.warehouse_id === wh)[k].storage_location_id, H = 3600000;
    putInventory('WH001', P('WH001', 'P0001'), c1, L('WH001', 0), addDays(-20), 100, 20, 0, 120, 2400, Date.now() - 2 * H);
    putInventory('WH001', P('WH001', 'P0002'), c2, L('WH001', 5), addDays(-40), 50, 0, 30, 100, 3200, Date.now() - 5 * H);
    putInventory('WH001', P('WH001', 'P0003'), c3, L('WH001', 9), addDays(-60), 0, 10, 0, 85, 1800, Date.now() - 9 * H);
    putInventory('WH001', P('WH001', 'P0008'), c4, L('WH001', 14), addDays(-10), 200, 0, 0, 60, 2000, Date.now() - 20 * H);
    putInventory('WH001', P('WH001', 'P0001'), c1, L('WH001', 20), addDays(-5), 0, 0, 0, 40, 900, Date.now() - 30 * H);
    putInventory('WH002', P('WH002', 'P0005'), c5, L('WH002', 0), addDays(-15), 150, 0, 0, 120, 3000, Date.now() - 3 * H);
    putInventory('WH002', P('WH002', 'P0006'), c6, L('WH002', 4), addDays(-30), 0, 0, 40, 110, 2500, Date.now() - 12 * H);
    putInventory('WH002', P('WH002', 'P0007'), c7, L('WH002', 9), addDays(-25), 0, 30, 0, 76, 2200, Date.now() - 26 * H);
    putInventory('WH003', P('WH003', 'P0001'), c8, L('WH003', 0), addDays(-8), 0, 0, 0, 117, 2300, Date.now() - 6 * H);
    [['RET0000001', 'INV0000001', 'Damaged', 'Crushed cartons in transit', 20, 20, -3, 'Full'], ['RET0000002', 'INV0000008', 'Damaged', 'Freezer door left open', 30, 15, -9, 'Partial'], ['RET0000003', 'INV0000007', 'Quarantined', 'Failed lab check', 40, 40, -15, 'Full']]
      .forEach((r) => db.returns.push({ return_id: r[0], inventory_id: r[1], return_type: r[2], return_reason: r[3], eligible_quantity: r[4], return_quantity: r[5], return_date: addDays(r[6]), return_scope: r[7], return_status: 'Recorded' }));
    // demo accounts - frontend mock only. Real passwords must be hashed on the server (password_hash / Hash::make).
    [['admin', 'Admin User', 'admin', 1], ['manager', 'Maya Manager', 'manager', 1], ['operator', 'Omar Operator', 'operator', 1], ['viewer', 'Vera Viewer', 'viewer', 1], ['new.hire', 'Nina Newhire', 'viewer', 0]]
      .forEach((u, i) => db.users.push({ id: i + 1, username: u[0], full_name: u[1], password: 'Demo@12345!', role: u[2], active: u[3], failed_attempts: 0, locked_until: null }));
    notify('info', 'Return RET0000001 recorded: 20 unit(s), Damaged, from INV0000001', 'returns?inv=INV0000001', 'seed:1', Date.now() - 3 * 864e5);
    notify('info', 'New sign-up: new.hire is awaiting approval', 'users', 'signup:new.hire', Date.now() - 36 * H);
    scanAlerts(true);
  }

  // ---------- auth & RBAC ----------
  const me = () => { const u = db.users.find((x) => x.id === S.uid); return u && u.active ? u : null; };
  const roleIn = (spec) => { const u = me(); return !!u && (spec === '*' || spec.includes(u.role)); };
  const canView = (pg) => roleIn((ACL[pg] || [[], []])[0]);
  const canWrite = (pg) => roleIn((ACL[pg] || [[], []])[1]);
  const USER_RE = /^[a-z0-9._-]{3,40}$/;
  function login(username, pw) {
    const u = db.users.find((x) => x.username === str(username).toLowerCase());
    if (u && u.locked_until && u.locked_until > Date.now()) return err('Too many failed attempts. Try again in a few minutes.');
    if (u && u.password === pw) {
      if (!u.active) return { ok: false, level: 'warn', msg: 'Your account is awaiting administrator approval.' };
      u.failed_attempts = 0; u.locked_until = null; S.uid = u.id; S.scanAt = 0; scanAlerts(); return ok('');
    }
    if (u) { u.failed_attempts++; if (u.failed_attempts >= 5) u.locked_until = Date.now() + 15 * 60000; }
    return err('Invalid username or password.');
  }
  const logout = () => { S.uid = null; };
  function signup(f) {
    const u = str(f.username).toLowerCase(), n = str(f.name), pw = String(f.password ?? '');
    S.su = S.su.filter((t) => t > Date.now() - 3600000);
    if (str(f.website) !== '') return ok('');
    if (SIGNUP_MODE === 'off') return err('Self sign-up is turned off. Ask an administrator for an account.');
    if (S.su.length >= 5) return err('Too many sign-up attempts. Please try again later.');
    if (!USER_RE.test(u)) return err('Username: 3–40 letters, numbers, dot, dash or underscore.');
    if (n === '') return err('Enter your full name.');
    if (pw.length < 10 || pw === u) return err('Password must be at least 10 characters and different from the username.');
    if (pw !== String(f.password2 ?? '')) return err('Passwords do not match.');
    S.su.push(Date.now());
    if (db.users.some((x) => x.username === u)) return err('That username is already taken.');
    db.users.push({ id: Math.max(0, ...db.users.map((x) => x.id)) + 1, username: u, full_name: n, password: pw, role: 'viewer', active: SIGNUP_MODE === 'open' ? 1 : 0, failed_attempts: 0, locked_until: null });
    notify('info', `New sign-up: ${u} ` + (SIGNUP_MODE === 'open' ? '(active as viewer)' : 'is awaiting approval'), 'users', 'signup:' + u);
    return ok(SIGNUP_MODE === 'open' ? 'Account created. You can sign in now (viewer access).' : 'Account created. An administrator must approve it before you can sign in.');
  }

  // ---------- notifications ----------
  function notify(level, msg, link, key, at) {
    if (key && db.notifications.some((n) => n.dedupe_key === key)) return;
    db.notifications.push({ id: Math.max(0, ...db.notifications.map((n) => n.id)) + 1, level, message: msg.slice(0, 255), link: link || null, dedupe_key: key || null, created_at: at || Date.now() });
  }
  const isRead = (nid) => db.reads.some((r) => r.u === S.uid && r.n === nid);
  const unreadCount = () => db.notifications.filter((n) => n.created_at > Date.now() - 30 * 864e5 && !isRead(n.id)).length;
  const recentNotifications = () => [...db.notifications].sort((a, b) => b.id - a.id).slice(0, 6).map((n) => ({ ...n, rd: isRead(n.id), ago: ago(n.created_at) }));
  const openNotification = (id) => { const n = db.notifications.find((x) => x.id === id); if (!n) return null; if (!isRead(id)) db.reads.push({ u: S.uid, n: id }); return /^[a-z_]+(\?[\w=&.%-]*)?$/.test(n.link || '') ? n.link : 'notifications'; };
  const markAllRead = () => { db.notifications.forEach((n) => { if (!isRead(n.id)) db.reads.push({ u: S.uid, n: n.id }); }); return ok('All notifications marked as read.'); };
  function utilRows() {
    const pos = {}, pal = {};
    db.storage.forEach((s) => { pos[s.warehouse_id] = (pos[s.warehouse_id] || 0) + 1; });
    db.inventory.forEach((i) => { pal[i.warehouse_id] = (pal[i.warehouse_id] || 0) + i.current_pallets; });
    return db.warehouses.map((w) => { const p = pos[w.warehouse_id] || 0, c = pal[w.warehouse_id] || 0, op = p * (1 - w.safety_buffer / 100); return { id: w.warehouse_id, name: w.warehouse_name, safety_buffer: w.safety_buffer, pos: p, pal: c, op, util: op > 0 ? Math.min((c / op) * 100, 100) : 0 }; });
  }
  function scanAlerts(force) {
    if (!force && Date.now() - S.scanAt < 300000) return; S.scanAt = Date.now();
    utilRows().forEach((r) => { if (r.util >= 85) { const full = r.util >= 100; notify(full ? 'danger' : 'warning', `${r.id} is at ${Math.round(r.util)}% utilization (${full ? 'full' : 'critical'})`, 'dashboard?wh=' + r.id, `cap:${r.id}${full ? ':full:' : ':crit:'}${today()}`); } });
    const lim = addDays(30); let n = 0;
    for (const b of db.batches) {
      if (!b.expiry || b.expiry > lim || n >= 50) continue;
      if (!db.inventory.some((i) => i.child_batch_id === b.child_batch_id && i.available_quantity > 0)) continue;
      n++; const x = b.expiry < today();
      notify(x ? 'danger' : 'warning', `Batch ${b.child_batch_id} ${x ? 'expired on ' : 'expires on '}${b.expiry}`, 'dashboard?wh=' + b.warehouse_id, `exp:${b.child_batch_id}${x ? ':x' : ':s'}`);
    }
  }

  // ---------- dashboard data (index.php) ----------
  function dash(wh) {
    const all = utilRows(), w = all.find((r) => r.id === wh);
    const inv = db.inventory.filter((i) => i.warehouse_id === wh), sum = (k) => inv.reduce((a, i) => a + i[k], 0);
    const name = (pid) => (db.products.find((p) => p.warehouse_id === wh && p.product_id === pid) || {}).product_name || '';
    const by = {}; inv.forEach((i) => { by[i.product_id] = (by[i.product_id] || 0) + i.current_quantity; });
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pid, v]) => [`${pid} ${name(pid)}`, v]);
    const since = addDays(-30), rt = {};
    db.returns.forEach((r) => { const i = db.inventory.find((x) => x.inventory_id === r.inventory_id); if (i && i.warehouse_id === wh && r.return_date >= since) rt[r.return_type] = (rt[r.return_type] || 0) + r.return_quantity; });
    const lim = addDays(30);
    const expiring = db.batches.filter((b) => b.warehouse_id === wh && b.expiry && b.expiry <= lim).map((b) => ({ child_batch_id: b.child_batch_id, product_id: b.product_id, expiry: b.expiry, available_units: inv.filter((i) => i.child_batch_id === b.child_batch_id).reduce((a, i) => a + i.available_quantity, 0) })).filter((r) => r.available_units >= 0 && inv.some((i) => i.child_batch_id === r.child_batch_id)).sort((a, b) => cmp(a.expiry, b.expiry)).slice(0, 8);
    const recent = [...inv].sort((a, b) => b.updated_at - a.updated_at).slice(0, 10).map((i) => ({ inventory_id: i.inventory_id, product_id: i.product_id, child_batch_id: i.child_batch_id, storage_location_id: i.storage_location_id, current_quantity: i.current_quantity, available_quantity: i.available_quantity, current_pallets: i.current_pallets }));
    return { info: db.warehouses.find((x) => x.warehouse_id === wh), w, all, inv: { cq: sum('current_quantity'), rq: sum('reserved_quantity'), aq: sum('available_quantity'), dq: sum('damaged_quantity'), qq: sum('quarantine_quantity') }, products: db.products.filter((p) => p.warehouse_id === wh).length, top, returns: Object.entries(rt), expiring, recent };
  }

  // ---------- page handlers (warehouse.php, storage.php, product.php, inventory.php, returns.php, users.php, import.php) ----------
  function addWarehouse(f) {
    const reg = str(f.region), name = str(f.name), type = str(f.type), loc = str(f.location), L = pnum(f.length, 1), W = pnum(f.width, 1), H = pnum(f.height, 1), wc = pnum0(f.weight);
    if (!['N', 'E', 'S', 'W'].includes(reg)) return err('Choose a valid region.');
    if (!name || !type || !loc) return err('Name, type and location are required.');
    if (L === null || W === null || H === null) return err('Length, width and height must be numbers of at least 1.');
    if (wc === null) return err('Weight capacity must be 0 or more.');
    const id = nextId(db.warehouses, 'warehouse_id', 'WH', 3), code = whCode(parseInt(id.slice(2), 10));
    db.warehouses.push({ warehouse_id: id, region: reg, warehouse_code: code, warehouse_name: name, warehouse_type: type, location: loc, length_ft: L, width_ft: W, height_ft: H, weight_capacity: wc, total_area: L * W, safety_buffer: 10 });
    return ok(`Warehouse ${id} saved (code ${code}).`);
  }
  function generateStorage(f) {
    const id = str(f.wh), n = {}, keys = ['zones', 'aisles', 'racks', 'levels', 'bins', 'positions'];
    keys.forEach((k) => { n[k] = pint(f[k], 1); });
    const buf = Number(f.buffer), W = db.warehouses.find((w) => w.warehouse_id === id);
    if (!W) return err('Choose a warehouse.');
    if (keys.some((k) => n[k] === null)) return err('All six counts must be whole numbers of at least 1.');
    if (![10, 15, 20].includes(buf)) return err('Choose a safety buffer.');
    const tot = keys.reduce((a, k) => a * n[k], 1);
    if (tot > 200000) return err(tot.toLocaleString('en-US') + ' positions is over the 200,000 limit.');
    if (db.inventory.some((i) => i.warehouse_id === id)) return err('Inventory already uses locations in this warehouse, so its structure cannot be regenerated.');
    db.storage = db.storage.filter((s) => s.warehouse_id !== id).concat(genStorage(id, n)); W.safety_buffer = buf;
    return ok(`Generated ${tot.toLocaleString('en-US')} pallet positions for ${id}.`);
  }
  function addProduct(wh, f) {
    const name = str(f.name), nc = str(f.net_content), ps = pint(f.pack, 1), cs = pint(f.case, 1), pl = pint(f.pallet, 1), upp = str(f.upp) === '' ? null : pint(f.upp, 1), dim = str(f.dims);
    let dv = null;
    if (dim) { const parts = dim.split(/[\s,x×*]+/i).filter(Boolean); if (parts.length === 3 && parts.every((x) => isFinite(+x))) dv = parts.join(' × '); }
    if (!name || !nc) return err('Product name and net content are required.');
    if (ps === null || cs === null || pl === null || (str(f.upp) !== '' && upp === null)) return err('Pack, case and pallet size (and units per pallet, if given) must be whole numbers of at least 1.');
    if (dim && dv === null) return err('Dimensions need exactly three numbers, e.g. 10 6 4.');
    const ex = db.products.find((p) => p.product_name.trim().toLowerCase() === name.toLowerCase() && p.net_content.trim().toLowerCase() === nc.toLowerCase());
    const pid = ex ? ex.product_id : nextId(db.products, 'product_id', 'P', 4);
    if (db.products.some((p) => p.warehouse_id === wh && p.product_id === pid)) return err(`This product already exists in ${wh}.`);
    db.products.push({ product_id: pid, warehouse_id: wh, product_name: name, category: str(f.category) || null, dimensions: dv, units_per_pallet: upp, net_content: nc, pack_size: ps, case_size: cs, pallet_size: pl, pallet_configuration: str(f.config) || null, temperature_requirement: str(f.temp) || null });
    return ok(`Product ${pid} added to ${wh}.`);
  }
  function addBatch(wh, f) {
    const pid = str(f.product), exp = str(f.expiry);
    if (!db.products.some((p) => p.warehouse_id === wh && p.product_id === pid)) return err('Choose a product of this warehouse.');
    if (exp && !validDate(exp)) return err('Expiry must be a valid date.');
    const b = createBatch(wh, pid, exp);
    return b ? ok(`Batch ${b.child_batch_id} created.`) : err('Could not create the batch (duplicate Child Batch ID?).');
  }
  function saveInventory(wh, P, f) {
    const child = str(f.child), loc = str(f.loc), md = str(f.mdate);
    const b = db.batches.find((x) => x.child_batch_id === child && x.warehouse_id === wh && x.product_id === P.product_id);
    const okLoc = db.storage.some((s) => s.warehouse_id === wh && s.storage_location_id === loc);
    const res = pint0(f.reserved), dam = pint0(f.damaged), qua = pint0(f.quarantine), pal = pnum0(f.pallets), wt = pnum0(f.weight), cur = P.pack_size * P.case_size * P.pallet_size;
    if (!b) return err('Choose a valid child batch for this product.');
    if (!okLoc) return err('Choose a storage location.');
    if (!validDate(md)) return err('Enter a valid manufacturing date.');
    if ([res, dam, qua, pal, wt].includes(null)) return err('Quantities, pallets and weight must be numbers of 0 or more.');
    if (cur - res - dam - qua < 0) return err('Available quantity cannot be negative.');
    const out = putInventory(wh, P, child, loc, md, res, dam, qua, pal, wt); scanAlerts(true); return ok(out.msg);
  }
  const eligible = (r, t) => (t === 'Damaged' ? r.damaged_quantity : t === 'Quarantined' ? r.quarantine_quantity : r.available_quantity);
  function saveReturn(r, f) {
    const t = str(f.type), reason = str(f.reason), qty = pint(f.qty, 1), types = ['Damaged', 'Expired', 'Quarantined', 'Other'];
    if (!types.includes(t)) return err('Choose a return type.');
    if (!reason) return err('Return reason is required.');
    if (qty === null) return err('Return quantity must be a whole number above 0.');
    if (!r) return err('Inventory record not found.');
    const el = eligible(r, t); if (qty > el) return err(`Return quantity exceeds the eligible quantity (${el}).`);
    const P = db.products.find((p) => p.warehouse_id === r.warehouse_id && p.product_id === r.product_id);
    r.current_quantity -= qty; if (t === 'Damaged') r.damaged_quantity -= qty; if (t === 'Quarantined') r.quarantine_quantity -= qty;
    r.available_quantity = Math.max(r.current_quantity - r.reserved_quantity - r.damaged_quantity - r.quarantine_quantity, 0); r.case_count = Math.floor(r.current_quantity / P.case_size); r.updated_at = Date.now();
    const rid = nextId(db.returns, 'return_id', 'RET', 7);
    db.returns.push({ return_id: rid, inventory_id: r.inventory_id, return_type: t, return_reason: reason, eligible_quantity: el, return_quantity: qty, return_date: today(), return_scope: qty === el ? 'Full' : 'Partial', return_status: 'Recorded' });
    notify('info', `Return ${rid} recorded: ${qty} unit(s), ${t}, from ${r.inventory_id}`, 'returns?inv=' + r.inventory_id);
    return ok(`Return ${rid} recorded.`);
  }
  function addUser(f) {
    const u = str(f.username).toLowerCase(), n = str(f.name), pw = String(f.password ?? ''), r = str(f.role);
    if (!USER_RE.test(u)) return err('Username: 3–40 letters, numbers, dot, dash or underscore.');
    if (!n) return err('Full name is required.');
    if (pw.length < 10) return err('Password must be at least 10 characters.');
    if (!ROLES.includes(r)) return err('Choose a role.');
    if (db.users.some((x) => x.username === u)) return err('That username already exists.');
    db.users.push({ id: Math.max(0, ...db.users.map((x) => x.id)) + 1, username: u, full_name: n, password: pw, role: r, active: 1, failed_attempts: 0, locked_until: null });
    return ok(`User ${u} created.`);
  }
  function editUser(id, f) {
    const u = db.users.find((x) => x.id === id), r = str(f.role), act = f.active ? 1 : 0, pw = String(f.password ?? '');
    if (!u || !ROLES.includes(r)) return err('Invalid request.');
    if (id === S.uid && (r !== 'admin' || !act)) return err('You cannot remove your own admin access.');
    if (pw !== '' && pw.length < 10) return err('New password must be at least 10 characters.');
    Object.assign(u, { role: r, active: act, failed_attempts: 0, locked_until: null }); if (pw) u.password = pw;
    return ok('User updated.');
  }

  // ---------- CSV import (import.php) ----------
  function parseCsv(text) {
    const rows = []; let row = [], f = '', q = false; text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }
  const has = (t, pred) => db[t].some(pred);
  const IMPORT = {
    warehouses: { label: 'Warehouses', req: ['warehouse_id', 'region', 'warehouse_code', 'warehouse_name', 'warehouse_type', 'location', 'length_ft', 'width_ft', 'height_ft'], opt: ['weight_capacity'], num: ['length_ft', 'width_ft', 'height_ft', 'weight_capacity'], dt: [],
      add: (r) => { if (has('warehouses', (w) => w.warehouse_id === r.warehouse_id || (w.region === r.region && w.warehouse_code === r.warehouse_code))) return 'dup'; db.warehouses.push({ weight_capacity: 0, ...r, total_area: r.length_ft * r.width_ft, safety_buffer: 10 }); } },
    storage: { label: 'Storage locations', req: ['warehouse_id', 'zone', 'aisle', 'rack', 'lvl', 'bin_no', 'pallet_position', 'storage_location_id'], opt: [], num: [], dt: [],
      add: (r) => { if (!has('warehouses', (w) => w.warehouse_id === r.warehouse_id)) return 'fk'; if (has('storage', (s) => s.warehouse_id === r.warehouse_id && s.storage_location_id === r.storage_location_id)) return 'dup'; db.storage.push(r); } },
    products: { label: 'Products', req: ['product_id', 'warehouse_id', 'product_name', 'net_content', 'pack_size', 'case_size', 'pallet_size'], opt: ['category', 'dimensions', 'units_per_pallet', 'pallet_configuration', 'temperature_requirement'], num: ['pack_size', 'case_size', 'pallet_size', 'units_per_pallet'], dt: [],
      add: (r) => { if (!has('warehouses', (w) => w.warehouse_id === r.warehouse_id)) return 'fk'; if (has('products', (p) => p.warehouse_id === r.warehouse_id && p.product_id === r.product_id)) return 'dup'; db.products.push({ category: null, dimensions: null, units_per_pallet: null, pallet_configuration: null, temperature_requirement: null, ...r }); } },
    batches: { label: 'Batches', req: ['parent_batch_id', 'child_batch_id', 'warehouse_id', 'region', 'warehouse_code', 'product_id'], opt: ['expiry'], num: [], dt: ['expiry'],
      add: (r) => { if (!has('products', (p) => p.warehouse_id === r.warehouse_id && p.product_id === r.product_id)) return 'fk'; if (has('batches', (b) => b.child_batch_id === r.child_batch_id)) return 'dup'; db.batches.push({ expiry: null, ...r }); } },
    inventory: { label: 'Inventory', req: ['inventory_id', 'parent_batch_id', 'child_batch_id', 'warehouse_id', 'storage_location_id', 'product_id', 'manufacturing_date', 'net_content', 'current_quantity', 'reserved_quantity', 'available_quantity', 'damaged_quantity', 'quarantine_quantity', 'case_count'], opt: ['inventory_weight', 'current_pallets'], num: ['inventory_weight', 'current_quantity', 'reserved_quantity', 'available_quantity', 'damaged_quantity', 'quarantine_quantity', 'case_count', 'current_pallets'], dt: ['manufacturing_date'],
      add: (r) => { if (!has('batches', (b) => b.child_batch_id === r.child_batch_id) || !has('products', (p) => p.warehouse_id === r.warehouse_id && p.product_id === r.product_id) || !has('storage', (s) => s.warehouse_id === r.warehouse_id && s.storage_location_id === r.storage_location_id)) return 'fk';
        if (has('inventory', (i) => i.inventory_id === r.inventory_id || (i.child_batch_id === r.child_batch_id && i.warehouse_id === r.warehouse_id && i.product_id === r.product_id && i.manufacturing_date === r.manufacturing_date && i.net_content === r.net_content))) return 'dup';
        db.inventory.push({ inventory_weight: 0, current_pallets: 0, ...r, updated_at: Date.now() }); } },
  };
  function importCsv(target, file) {
    const T = IMPORT[target];
    if (!T) return err('Choose what you are importing.');
    if (!file || !file.text) return err('Upload failed. Please choose a file.');
    if (!/\.csv$/i.test(file.name)) return err('Only .csv files are supported. In Excel use Save As → CSV.');
    const rows = parseCsv(file.text), alias = { level: 'lvl', bin: 'bin_no' };
    const hdr = (rows.shift() || []).map((c) => { c = str(c).toLowerCase(); return alias[c] || c; });
    const miss = T.req.filter((c) => !hdr.includes(c));
    if (miss.length) return err('Missing columns: ' + miss.join(', '));
    const use = [...new Set(hdr.filter((c) => T.req.includes(c) || T.opt.includes(c)))];
    let ins = 0, dup = 0, skip = 0, line = 1; const errs = [];
    for (const r of rows) {
      if (++line > 50001) { errs.push('Stopped at 50,000 rows.'); break; }
      const row = {}; hdr.forEach((c, i) => { row[c] = str(r[i]); });
      let bad = null;
      T.req.forEach((c) => { if (row[c] === '') bad = `${c} is empty`; });
      T.num.forEach((c) => { if ((row[c] ?? '') !== '' && (!isFinite(+row[c]) || +row[c] < 0)) bad = `${c} must be a number of 0 or more`; });
      T.dt.forEach((c) => { if ((row[c] ?? '') !== '' && !validDate(row[c])) bad = `${c} must be YYYY-MM-DD`; });
      if (target === 'warehouses' && !['N', 'E', 'S', 'W'].includes(row.region)) bad = 'region must be N, E, S or W';
      if (bad === null) {
        const rec = {}; use.forEach((c) => { const v = row[c]; rec[c] = v === '' ? (T.num.includes(c) && T.opt.includes(c) ? 0 : null) : T.num.includes(c) ? Number(v) : v; });
        const res = T.add(rec); if (res === 'dup') dup++; else if (res === 'fk') bad = 'refers to a missing record or has an invalid value'; else ins++;
      }
      if (bad !== null) { skip++; if (errs.length < 15) errs.push(`Row ${line}: ${bad}`); }
    }
    scanAlerts(true);
    const out = { ok: !skip, level: skip ? 'warn' : 'ok', msg: `Imported ${ins} row(s); ${dup} duplicate(s) ignored; ${skip} row(s) rejected.` };
    if (errs.length) out.extra = [{ level: 'warn', msg: errs.join(' | ') }];
    return out;
  }

  // ---------- context (selected warehouse / product / inventory record) ----------
  function ctxFor(q = {}) {
    const whs = db.warehouses, wh = whs.some((w) => w.warehouse_id === q.wh) ? q.wh : (whs[0] || {}).warehouse_id || '';
    const prods = db.products.filter((p) => p.warehouse_id === wh).sort((a, b) => cmp(a.product_id, b.product_id));
    const invs = [...db.inventory].sort((a, b) => cmp(a.inventory_id, b.inventory_id));
    return { wh, whs, prods, prod: prods.find((p) => p.product_id === q.prod) || prods[0] || null, invs, inv: invs.find((i) => i.inventory_id === q.inv) || invs[0] || null };
  }
  const whMap = (c) => Object.fromEntries(c.whs.map((w) => [w.warehouse_id, w.warehouse_id + ' – ' + w.warehouse_name]));
  const prodMap = (c, withNc) => Object.fromEntries(c.prods.map((p) => [p.product_id, `${p.product_id} – ${p.product_name}` + (withNc ? ` (${p.net_content})` : '')]));
  const occSet = (wh) => new Set(db.inventory.filter((i) => i.warehouse_id === wh).map((i) => i.storage_location_id));
  const distinct = (arr) => opts([...new Set(arr.filter(Boolean))].sort());

  // ---------- forms ----------
  const F = (name, label, o = {}) => ({ name, label, type: 'text', ...o });
  const FORMS = {
    warehouse: { submit: 'Save Warehouse', run: (v) => addWarehouse(v), fields: [
      F('id', 'Warehouse ID (auto)', { disabled: true, value: () => nextId(db.warehouses, 'warehouse_id', 'WH', 3) }), F('region', 'Region', { type: 'select', options: () => opts(['N', 'E', 'S', 'W']) }),
      F('name', 'Name', { required: true, maxlength: 150 }), F('type', 'Type', { required: true, maxlength: 80, placeholder: 'Ambient' }), F('location', 'Location', { required: true, maxlength: 200 }),
      F('length', 'Length (ft)', { type: 'number', min: 1, step: 'any', required: true }), F('width', 'Width (ft)', { type: 'number', min: 1, step: 'any', required: true }), F('height', 'Height (ft)', { type: 'number', min: 1, step: 'any', required: true }), F('weight', 'Weight capacity (kg)', { type: 'number', min: 0, step: 'any' })] },
    storage: { submit: 'Generate Storage Structure', run: (v) => generateStorage(v), calc: ['zones', 'aisles', 'racks', 'levels', 'bins', 'positions'], calcLabel: 'Pallet positions to generate', note: () => "Regenerating replaces this warehouse's existing positions.", fields: [
      F('wh', 'Warehouse', { type: 'select', options: (c) => Object.fromEntries(c.whs.map((w) => [w.warehouse_id, w.warehouse_name])), def: (c) => c.wh }),
      ...[['zones', 'Zones'], ['aisles', 'Aisles per zone'], ['racks', 'Racks per aisle'], ['levels', 'Levels per rack'], ['bins', 'Bins per level'], ['positions', 'Pallet positions per bin']].map(([k, l]) => F(k, l, { type: 'number', min: 1, step: 1, required: true, def: () => '1' })),
      F('buffer', 'Safety buffer (%)', { type: 'select', options: () => ({ 10: '10', 15: '15', 20: '20' }) })] },
    product: { submit: 'Add Product', run: (v, c) => addProduct(c.wh, v), fields: [
      F('name', 'Product name', { required: true, maxlength: 200 }), F('net_content', 'Net content (e.g. 500 g)', { required: true, maxlength: 50 }), F('category', 'Category', { maxlength: 100 }), F('dims', 'Dimensions (3 numbers)', { placeholder: '10 6 4' }),
      F('upp', 'Units per pallet', { type: 'number', min: 1 }), F('pack', 'Pack size', { type: 'number', min: 1, required: true }), F('case', 'Case size', { type: 'number', min: 1, required: true }), F('pallet', 'Pallet size', { type: 'number', min: 1, required: true }),
      F('config', 'Pallet configuration', { maxlength: 150 }), F('temp', 'Temperature requirement', { maxlength: 100 })] },
    batch: { submit: 'Add Batch', run: (v, c) => addBatch(c.wh, v), blocked: (c) => (c.prods.length ? null : 'Add a product to this warehouse first.'), fields: [
      F('product', 'Product', { type: 'select', options: (c) => prodMap(c, true) }), F('expiry', 'Expiry (optional)', { type: 'date' })] },
    inventory: { submit: 'Save Inventory', run: (v, c) => saveInventory(c.wh, c.prod, v),
      blocked: (c) => !c.prod ? 'No products in this warehouse yet. Add one on the Product & Batch page.' : !db.batches.some((b) => b.warehouse_id === c.wh && b.product_id === c.prod.product_id) ? 'This product has no batch yet. Create one on the Product & Batch page.' : !db.storage.some((s) => s.warehouse_id === c.wh) ? 'No storage locations yet. Generate them on the Storage page.' : null,
      note: (c) => c.prod ? `Current quantity = pack × case × pallet = ${c.prod.pack_size} × ${c.prod.case_size} × ${c.prod.pallet_size} = ${c.prod.pack_size * c.prod.case_size * c.prod.pallet_size}. Saving the same batch, product, date and net content again updates that record.` : '',
      fields: [F('loc', 'Storage location', { type: 'select', options: (c) => Object.fromEntries(db.storage.filter((s) => s.warehouse_id === c.wh).slice(0, 5000).map((s) => [s.storage_location_id, s.storage_location_id])) }),
        F('child', 'Child batch', { type: 'select', options: (c) => Object.fromEntries(db.batches.filter((b) => b.warehouse_id === c.wh && c.prod && b.product_id === c.prod.product_id).map((b) => [b.child_batch_id, b.child_batch_id])) }),
        F('mdate', 'Manufacturing date', { type: 'date', required: true, def: () => today() }), F('nc', 'Net content', { disabled: true, value: (c) => (c.prod ? c.prod.net_content : '') }),
        F('weight', 'Inventory weight (kg)', { type: 'number', min: 0, step: 'any' }), F('reserved', 'Reserved qty', { type: 'number', min: 0 }), F('damaged', 'Damaged qty', { type: 'number', min: 0 }), F('quarantine', 'Quarantine qty', { type: 'number', min: 0 }), F('pallets', 'Current pallets', { type: 'number', min: 0, step: 'any' })] },
    returns: { submit: 'Save Return', run: (v, c) => saveReturn(c.inv, v), blocked: (c) => (c.inv ? null : 'No inventory records yet.'),
      note: (c) => c.inv ? `Eligible now: Damaged ${c.inv.damaged_quantity} · Quarantined ${c.inv.quarantine_quantity} · Expired / Other (from available) ${c.inv.available_quantity}` : '',
      fields: [F('type', 'Return type', { type: 'select', options: () => opts(['Damaged', 'Expired', 'Quarantined', 'Other']) }), F('qty', 'Return quantity', { type: 'number', min: 1, required: true }), F('reason', 'Reason', { required: true, maxlength: 255 })] },
    user: { submit: 'Add User', run: (v) => addUser(v), fields: [
      F('username', 'Username', { required: true, maxlength: 40 }), F('name', 'Full name', { required: true, maxlength: 100 }), F('password', 'Password (10+ chars)', { type: 'password', required: true }),
      F('role', 'Role', { type: 'select', options: () => opts(ROLES), def: () => 'operator' })] },
    import: { submit: 'Import', run: (v) => importCsv(v.target, v.file), note: () => 'Import in this order: warehouses → storage → products → batches → inventory. Headers are case-insensitive; Level and Bin are accepted for lvl and bin_no.', fields: [
      F('target', 'Import into', { type: 'select', options: () => Object.fromEntries(Object.entries(IMPORT).map(([k, t]) => [k, t.label])) }), F('file', 'CSV file', { type: 'file', accept: '.csv', required: true })] },
  };
  const importHelp = () => Object.entries(IMPORT).map(([k, t]) => [k[0].toUpperCase() + k.slice(1), t.req.join(', ') + (t.opt.length ? `  (optional: ${t.opt.join(', ')})` : '')]);

  // ---------- lists (search / filter / pagination) ----------
  const dateOpts = (col, days) => (r, v) => r[col] >= addDays(-Number(v));
  const LISTS = {
    warehouses: { search: ['warehouse_id', 'warehouse_name', 'location', 'warehouse_type'], sort: ['warehouse_id', 1],
      rows: () => db.warehouses.map(({ warehouse_id, region, warehouse_code, warehouse_name, warehouse_type, location, length_ft, width_ft, height_ft, weight_capacity, total_area }) => ({ warehouse_id, region, warehouse_code, warehouse_name, warehouse_type, location, length_ft, width_ft, height_ft, weight_capacity, total_area })),
      filters: { region: { label: 'Region', opts: () => opts(['N', 'E', 'S', 'W']), test: (r, v) => r.region === v }, type: { label: 'Type', opts: () => distinct(db.warehouses.map((w) => w.warehouse_type)), test: (r, v) => r.warehouse_type === v } } },
    locations: { search: ['storage_location_id'], sort: null,
      rows: (c) => { const occ = occSet(c.wh); return db.storage.filter((s) => s.warehouse_id === c.wh).map((s) => ({ storage_location_id: s.storage_location_id, zone: s.zone, aisle: s.aisle, rack: s.rack, lvl: s.lvl, bin_no: s.bin_no, pallet_position: s.pallet_position, status: occ.has(s.storage_location_id) ? 'Occupied' : 'Free' })); },
      filters: { zone: { label: 'Zone', opts: (c) => distinct(db.storage.filter((s) => s.warehouse_id === c.wh).map((s) => s.zone)), test: (r, v) => r.zone === v }, status: { label: 'Status', opts: () => ({ occ: 'Occupied', free: 'Free' }), test: (r, v) => r.status === (v === 'occ' ? 'Occupied' : 'Free') } } },
    products: { search: ['product_id', 'product_name', 'category'], sort: ['product_id', 1],
      rows: (c) => db.products.filter((p) => p.warehouse_id === c.wh).map(({ product_id, product_name, category, dimensions, units_per_pallet, net_content, pack_size, case_size, pallet_size, pallet_configuration, temperature_requirement }) => ({ product_id, product_name, category, dimensions, units_per_pallet, net_content, pack_size, case_size, pallet_size, pallet_configuration, temperature_requirement })),
      filters: { cat: { label: 'Category', opts: (c) => distinct(db.products.filter((p) => p.warehouse_id === c.wh).map((p) => p.category)), test: (r, v) => r.category === v } } },
    batches: { search: ['parent_batch_id', 'child_batch_id', 'product_id'], sort: null, rev: true,
      rows: (c) => db.batches.filter((b) => b.warehouse_id === c.wh).map(({ parent_batch_id, child_batch_id, product_id, region, warehouse_code, expiry }) => ({ parent_batch_id, child_batch_id, product_id, region, warehouse_code, expiry })),
      filters: { product: { label: 'Product', opts: (c) => prodMap(c, true), test: (r, v) => r.product_id === v },
        expiry: { label: 'Expiry', opts: () => ({ soon: 'Within 30 days', expired: 'Expired', none: 'No expiry' }), test: (r, v) => (v === 'soon' ? r.expiry && r.expiry >= today() && r.expiry <= addDays(30) : v === 'expired' ? r.expiry && r.expiry < today() : !r.expiry) } } },
    inventory: { search: ['inventory_id', 'product_id', 'child_batch_id', 'storage_location_id'], sort: ['inventory_id', 1],
      rows: (c) => db.inventory.filter((i) => i.warehouse_id === c.wh).map((i) => ({ inventory_id: i.inventory_id, product_id: i.product_id, child_batch_id: i.child_batch_id, storage_location_id: i.storage_location_id, manufacturing_date: i.manufacturing_date, current_quantity: i.current_quantity, reserved_quantity: i.reserved_quantity, available_quantity: i.available_quantity, damaged_quantity: i.damaged_quantity, quarantine_quantity: i.quarantine_quantity, case_count: i.case_count, current_pallets: i.current_pallets })),
      filters: { product: { label: 'Product', opts: (c) => prodMap(c), test: (r, v) => r.product_id === v },
        stock: { label: 'Stock', opts: () => ({ dam: 'Has damaged', qua: 'Has quarantine', res: 'Has reserved', out: 'Nothing available' }), test: (r, v) => (v === 'dam' ? r.damaged_quantity > 0 : v === 'qua' ? r.quarantine_quantity > 0 : v === 'res' ? r.reserved_quantity > 0 : r.available_quantity === 0) } } },
    returns: { search: ['return_id', 'inventory_id', 'return_reason'], sort: ['return_id', -1],
      rows: () => db.returns.map(({ return_id, inventory_id, return_type, return_reason, eligible_quantity, return_quantity, return_date, return_scope, return_status }) => ({ return_id, inventory_id, return_type, return_reason, eligible_quantity, return_quantity, return_date, return_scope, return_status })),
      filters: { type: { label: 'Type', opts: () => opts(['Damaged', 'Expired', 'Quarantined', 'Other']), test: (r, v) => r.return_type === v }, scope: { label: 'Scope', opts: () => opts(['Full', 'Partial']), test: (r, v) => r.return_scope === v },
        period: { label: 'Period', opts: () => ({ 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' }), test: dateOpts('return_date') } } },
    users: { search: ['username', 'full_name'], sort: ['id', 1], per: 10,
      rows: () => db.users.map(({ id, username, full_name, role, active }) => ({ id, username, full_name, role, active })),
      filters: { role: { label: 'Role', opts: () => opts(ROLES), test: (r, v) => r.role === v }, status: { label: 'Status', opts: () => ({ active: 'Active', pending: 'Inactive / pending' }), test: (r, v) => (v === 'active' ? r.active : !r.active) } } },
    notifications: { search: ['message'], sort: ['id', -1],
      rows: () => db.notifications.map((n) => ({ id: n.id, level: n.level, message: n.message, created_at: n.created_at, rd: isRead(n.id), _ago: ago(n.created_at), _ts: fmtTs(n.created_at) })),
      filters: { level: { label: 'Level', opts: () => ({ info: 'Info', success: 'Success', warning: 'Warning', danger: 'Critical' }), test: (r, v) => r.level === v }, read: { label: 'Status', opts: () => ({ unread: 'Unread', read: 'Read' }), test: (r, v) => (v === 'unread' ? !r.rd : r.rd) } } },
  };
  function listQuery(id, P = {}, c) {
    const L = LISTS[id]; let rows = L.rows(c); const s = str(P.q).toLowerCase();
    if (s && L.search) rows = rows.filter((r) => L.search.some((k) => String(r[k] ?? '').toLowerCase().includes(s)));
    for (const [k, f] of Object.entries(L.filters || {})) if (P.f && P.f[k]) rows = rows.filter((r) => f.test(r, P.f[k]));
    if (L.sort) rows.sort((a, b) => cmp(a[L.sort[0]], b[L.sort[0]]) * L.sort[1]); else if (L.rev) rows.reverse();
    const total = rows.length, n = [10, 15, 25, 50, 100].includes(+P.n) ? +P.n : L.per || 15, pages = Math.max(1, Math.ceil(total / n)), page = Math.min(Math.max(+P.p || 1, 1), pages);
    const cols = rows[0] ? Object.keys(rows[0]).filter((k) => k[0] !== '_') : [];
    return { rows: rows.slice((page - 1) * n, page * n), cols, total, pages, page, n, active: !!s || Object.values(P.f || {}).some(Boolean) };
  }
  const listFilters = (id, c) => Object.entries(LISTS[id].filters || {}).map(([key, f]) => ({ key, label: f.label, opts: f.opts(c) }));
  const hasSearch = (id) => !!LISTS[id].search;
  const storageSummary = () => { const pos = {}; db.storage.forEach((s) => { pos[s.warehouse_id] = (pos[s.warehouse_id] || 0) + 1; }); return db.warehouses.map((w) => ({ warehouse_id: w.warehouse_id, pallet_positions: pos[w.warehouse_id] || 0, safety_buffer: w.safety_buffer })); };

  // ---------- page layouts (blocks rendered by the UI) ----------
  const T = (x) => ({ t: 'h2', x });
  const PAGES = {
    dashboard: { title: 'Dashboard', sub: 'Live capacity, stock health and alerts across your warehouses' },
    warehouse: { title: 'Warehouse Information', sub: 'Register sites and review their dimensions', blocks: [{ t: 'form', id: 'warehouse' }, T('Warehouses'), { t: 'list', id: 'warehouses' }] },
    storage: { title: 'Storage Structure', sub: 'Generate and browse pallet positions', needsWh: true, blocks: [{ t: 'form', id: 'storage' }, T('Existing structures'), { t: 'table', fn: storageSummary }, T('Browse pallet locations'), { t: 'bar' }, { t: 'list', id: 'locations' }] },
    product: { title: 'Product & Batch', sub: 'Maintain the catalogue and track batches and expiry', needsWh: true, blocks: [{ t: 'bar' }, T('Add product'), { t: 'form', id: 'product' }, T('Add parent / warehouse batch'), { t: 'form', id: 'batch' }, T((c) => 'Products in ' + c.wh), { t: 'list', id: 'products' }, T((c) => 'Batches in ' + c.wh), { t: 'list', id: 'batches' }] },
    inventory: { title: 'Inventory', sub: 'Receive stock and monitor reserved, damaged and quarantined units', needsWh: true, blocks: [{ t: 'bar', prod: true }, { t: 'form', id: 'inventory' }, T((c) => 'Inventory in ' + c.wh), { t: 'list', id: 'inventory' }] },
    returns: { title: 'Product Returns', sub: 'Record returns against inventory with eligibility checks', blocks: [{ t: 'invbar' }, { t: 'form', id: 'returns' }, T('Returns history'), { t: 'list', id: 'returns' }] },
    import: { title: 'Data Ingestion', sub: 'Bulk-load data from CSV files', blocks: [{ t: 'form', id: 'import' }, T('Required columns'), { t: 'help' }] },
    users: { title: 'Users & Roles', sub: 'Manage team members and their access', blocks: [{ t: 'msg', x: 'Roles: admin – everything incl. users · manager – setup, inventory, returns, import · operator – inventory and returns · viewer – read-only.' }, { t: 'form', id: 'user' }, T('Team'), { t: 'list', id: 'users', render: 'users' }] },
    notifications: { title: 'Notifications', sub: 'Capacity, expiry and return alerts', blocks: [{ t: 'markAll' }, { t: 'list', id: 'notifications', render: 'notif' }] },
  };
  const txt = (x, c) => (typeof x === 'function' ? x(c) : x);


  // colour tag for status-like table cells: returns 'ok' | 'wa' | 'er' | 'in' | 'mu' or null
  function badge(col, v) {
    const m = { status: { Occupied: 'in', Free: 'ok' }, return_type: { Damaged: 'er', Expired: 'wa', Quarantined: 'wa', Other: 'mu' }, return_scope: { Full: 'in', Partial: 'mu' }, return_status: { Recorded: 'ok' } };
    if (m[col]) return m[col][v] || null;
    if (col === 'expiry' && v) return v < today() ? 'er' : v <= addDays(30) ? 'wa' : null;
    if (col === 'damaged_quantity' && v > 0) return 'er';
    if (col === 'quarantine_quantity' && v > 0) return 'wa';
    return null;
  }

  seed();
  return { APP, ROLES, MODULES, NAV, ACL, PAGES, FORMS, db, signupMode: SIGNUP_MODE,
    me, canView, canWrite, login, logout, signup, unreadCount, recentNotifications, openNotification, markAllRead, scanAlerts,
    editUser, ctxFor, whMap, prodMap, listQuery, listFilters, hasSearch, importHelp, txt, dash, badge, statusOf, today, ago, eligible };
})();
