const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = process.env.APPOFICINA_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const PORT = Number(process.env.PORT || 4173);
const SESSION_MS = 45 * 60 * 1000;
const NETWORK_CONFIG = fs.existsSync(path.join(ROOT, 'network.config.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'network.config.json'), 'utf8')) : { primaryLabel: 'WiFi actual', backupSsid: 'Takego' };
const sessions = new Map();
const DEFAULT_OFFICE_ACCOUNTS = [
  { username: 'leandro', displayName: 'Leandro', password: '11cd9cb9aa9bad26604bfc2421acf3fe:0551f75bd4716aa0d2a90bc3b30ad583b8763d2d43b19d96ea733992c33158671862a7478c2c21cc9001568a92a87133e5b92536e9fad63b4abd52e8717142a0' },
  { username: 'alfredo', displayName: 'Alfredo', password: '81026340ecf82154b741d545925a431f:162359b412fdba33742e2cb754fe3d35e9224743fb85c778882a5e3ab9e4a2e483b862a3ca66751a23273859269939bae2c50f1aa40829ec6d70fc96d3c56ee6' }
];

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, derived) => {
    if (err) reject(err); else resolve(`${salt}:${derived.toString('hex')}`);
  }));
}
function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, expected] = String(stored || '').split(':');
    if (!salt || !expected) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err); else resolve(crypto.timingSafeEqual(Buffer.from(expected, 'hex'), derived));
    });
  });
}
function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  return { users: [], officeUsers: [] };
}
let db = loadDb();
async function ensureOffice() {
  const previous = JSON.stringify({ officeUsers: db.officeUsers || [], reset: db.deliverysResetV1, users: db.users || [] });
  db.officeUsers = DEFAULT_OFFICE_ACCOUNTS.map(account => ({ ...account, role: 'office' }));
  delete db.officeUser;
  delete db.officePassword;
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.deliverysResetV1) db.deliverysResetV1 = true;
  db.users = db.users.filter(u => u.role === 'delivery').map(u => ({ ...u, clients: cleanClients(u.clients), mapUrl: String(u.mapUrl || '') }));
  if (previous !== JSON.stringify({ officeUsers: db.officeUsers, reset: db.deliverysResetV1, users: db.users })) saveDb();
}
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function cookie(res, token) { res.setHeader('Set-Cookie', `appoficina_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`); }
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => x.trim().split('=')) .filter(x => x.length === 2)); }
function auth(req) {
  const token = parseCookies(req).appoficina_session || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.lastActivity > SESSION_MS) { sessions.delete(token); return null; }
  session.lastActivity = Date.now();
  return session.user;
}
function publicDelivery(user) { return { username: user.username, displayName: user.displayName, role: 'delivery', clients: user.clients || [], mapUrl: user.mapUrl || '' }; }
function currentUser(req) { return auth(req); }
function isOffice(user) { return user?.role === 'office'; }
function cleanClients(clients) { return Array.isArray(clients) ? clients.map((c, i) => ({ id: String(c.id || `${Date.now()}-${i}`), name: String(c.name || 'Sin nombre').slice(0, 120), address: String(c.address || '').slice(0, 240), phone: String(c.phone || '').slice(0, 60), amount: String(c.amount || '').slice(0, 40), officeNote: String(c.officeNote || '').slice(0, 500), status: ['Entregado', 'Rechazado', 'En proceso'].includes(c.status) ? c.status : 'En proceso', note: String(c.note || '').slice(0, 500), notePhoto: String(c.notePhoto || '').slice(0, 800000) })) : []; }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON inválido')); } }); }); }
function sendFile(req, res) {
  const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const name = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const file = path.resolve(ROOT, name);
  if (!file.startsWith(path.resolve(ROOT)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'No encontrado' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { user: auth(req) });
    if (url.pathname === '/api/deliveries' && req.method === 'GET') { const user = currentUser(req); if (!isOffice(user)) return json(res, 403, { error: 'Solo Oficina puede consultar los deliveries.' }); return json(res, 200, { deliveries: db.users.map(publicDelivery) }); }
    if (url.pathname === '/api/my-route' && req.method === 'GET') { const user = currentUser(req); if (!user || user.role !== 'delivery') return json(res, 403, { error: 'Solo un delivery puede consultar su ruta.' }); const delivery = db.users.find(u => u.username === user.username); return json(res, 200, { delivery: delivery ? publicDelivery(delivery) : null }); }
    const routeMatch = url.pathname.match(/^\/api\/deliveries\/([^/]+)\/route$/);
    if (routeMatch && req.method === 'GET') { const user = currentUser(req); if (!isOffice(user)) return json(res, 403, { error: 'Solo Oficina puede consultar la ruta de un delivery.' }); const delivery = db.users.find(u => u.username === decodeURIComponent(routeMatch[1]).toLowerCase()); return json(res, delivery ? 200 : 404, { delivery: delivery ? publicDelivery(delivery) : null, error: delivery ? undefined : 'Delivery no encontrado.' }); }
    if (routeMatch && req.method === 'PUT') { const user = currentUser(req); if (!isOffice(user)) return json(res, 403, { error: 'Solo Oficina puede asignar rutas.' }); const username = decodeURIComponent(routeMatch[1]).toLowerCase(), delivery = db.users.find(u => u.username === username); if (!delivery) return json(res, 404, { error: 'Delivery no encontrado.' }); const data = await body(req), incoming = Array.isArray(data.clients) ? data.clients : [], previous = new Map((delivery.clients || []).map(c => [String(c.id), c])), cleaned = cleanClients(incoming); delivery.clients = cleaned.map((client, index) => { const raw = incoming[index] || {}, old = previous.get(String(client.id)); if (!Object.prototype.hasOwnProperty.call(raw, 'officeNote') && old) client.officeNote = String(old.officeNote || ''); if (!Object.prototype.hasOwnProperty.call(raw, 'notePhoto') && old) client.notePhoto = String(old.notePhoto || ''); return client; }); delivery.mapUrl = String(data.mapUrl || ''); saveDb(); return json(res, 200, { delivery: publicDelivery(delivery) }); }
    if (url.pathname === '/api/my-route' && req.method === 'PUT') { const user = currentUser(req); if (!user || user.role !== 'delivery') return json(res, 403, { error: 'Solo un delivery puede actualizar su ruta.' }); const delivery = db.users.find(u => u.username === user.username); if (!delivery) return json(res, 404, { error: 'Delivery no encontrado.' }); const updates = cleanClients((await body(req)).clients); const byId = new Map(updates.map(c => [c.id, c])); delivery.clients = (delivery.clients || []).map(c => { const update = byId.get(String(c.id)); return update ? { ...c, status: update.status, note: update.note, notePhoto: update.notePhoto } : c; }); saveDb(); return json(res, 200, { delivery: publicDelivery(delivery) }); }
    if (url.pathname === '/api/network-config' && req.method === 'GET') return json(res, 200, { primaryLabel: NETWORK_CONFIG.primaryLabel, backupSsid: NETWORK_CONFIG.backupSsid, serverPort: NETWORK_CONFIG.serverPort });
    if (url.pathname === '/api/logout' && req.method === 'POST') { const token = parseCookies(req).appoficina_session || String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); sessions.delete(token); res.setHeader('Set-Cookie', 'appoficina_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/register-delivery' && req.method === 'POST') {
      const data = await body(req), username = String(data.username || '').trim().toLowerCase(), password = String(data.password || '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8) return json(res, 400, { error: 'Usuario inválido o contraseña demasiado corta (mínimo 8 caracteres).' });
      if (db.officeUsers.some(u => u.username === username) || db.users.some(u => u.username === username)) return json(res, 409, { error: 'Ese usuario ya está registrado.' });
      db.users.push({ username, displayName: String(data.displayName || username).trim().slice(0, 80), role: 'delivery', password: await hashPassword(password), clients: [], mapUrl: '', createdAt: new Date().toISOString() }); saveDb();
      return json(res, 201, { ok: true });
    }
    const deleteDeliveryMatch = url.pathname.match(/^\/api\/deliveries\/([^/]+)$/);
    if (deleteDeliveryMatch && req.method === 'PUT') {
      const user = currentUser(req);
      if (!isOffice(user)) return json(res, 403, { error: 'Solo Oficina puede cambiar contraseñas de delivery.' });
      const username = decodeURIComponent(deleteDeliveryMatch[1]).toLowerCase();
      const delivery = db.users.find(u => u.username === username && u.role === 'delivery');
      if (!delivery) return json(res, 404, { error: 'Delivery no encontrado.' });
      const data = await body(req), password = String(data.password || '');
      if (password.length < 8) return json(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
      delivery.password = await hashPassword(password);
      for (const [token, session] of sessions) if (session.user?.username === username) sessions.delete(token);
      saveDb();
      return json(res, 200, { ok: true });
    }
    if (deleteDeliveryMatch && req.method === 'DELETE') {
      const user = currentUser(req);
      if (!isOffice(user)) return json(res, 403, { error: 'Solo Oficina puede eliminar cuentas de delivery.' });
      const username = decodeURIComponent(deleteDeliveryMatch[1]).toLowerCase();
      const index = db.users.findIndex(u => u.username === username && u.role === 'delivery');
      if (index < 0) return json(res, 404, { error: 'Delivery no encontrado.' });
      db.users.splice(index, 1);
      for (const [token, session] of sessions) if (session.user?.username === username) sessions.delete(token);
      saveDb();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const data = await body(req), username = String(data.username || '').trim().toLowerCase(), password = String(data.password || '');
      let user = null;
      const office = db.officeUsers.find(u => u.username === username);
      if (office && await verifyPassword(password, office.password)) user = { username: office.username, displayName: office.displayName, role: 'office' };
      const delivery = db.users.find(u => u.username === username);
      if (!user && delivery && await verifyPassword(password, delivery.password)) user = { username: delivery.username, displayName: delivery.displayName, role: 'delivery' };
      if (!user) return json(res, 401, { error: 'Credenciales incorrectas.' });
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { user, lastActivity: Date.now() }); cookie(res, token); return json(res, 200, { user, token });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ruta API no encontrada' });
    return sendFile(req, res);
  } catch (error) { console.error(error); return json(res, 500, { error: 'Error interno del servidor.' }); }
});
ensureOffice().then(() => server.listen(PORT, '0.0.0.0', () => console.log(`AppOficina disponible en http://localhost:${PORT}`)));
