'use strict';
/*
 * Deliberately vulnerable lab target for the RedTeam live gauntlet.
 * Node.js standard library ONLY. Every vulnerability here is PLANTED —
 * see README.md in this directory for the scoring ground truth.
 *
 * Run: node server.js   (binds 127.0.0.1:8080)
 */
const http = require('http');
const crypto = require('crypto');

const PORT = 8080;
const HOST = '127.0.0.1';

/* ---------------- In-memory "database" ---------------- */
const users = [
  { id: 1, username: 'admin', password: 'admin123', name: 'Ada Admin',    email: 'admin@lab.local',  role: 'admin' },
  { id: 2, username: 'alice', password: 'wonderland', name: 'Alice Liddell', email: 'alice@lab.local', role: 'user' },
  { id: 3, username: 'bob',   password: 'builder',   name: 'Bob Builder',  email: 'bob@lab.local',   role: 'user' },
];
const sessions = new Map(); // sessionId -> userId

/*
 * PLANTED VULN 3 — SQL injection.
 * The original code built its query by string concatenation:
 *   SELECT * FROM users WHERE username = '<u>' AND password = '<p>'
 * This function simulates the effect of that concatenated query against the
 * in-memory table, including the classic tautology bypass: any username (or
 * password) carrying  ' OR '1'='1  (or 1=1, with optional -- comment) makes
 * the WHERE clause true for the row named before the quote.
 */
function vulnerableLogin(username, password) {
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  // Detect the injected tautology the way the real concatenated query would behave.
  const tautology = /'\s*or\s*(?:'1'\s*=\s*'1'|1\s*=\s*1)/i;
  if (tautology.test(username) || tautology.test(password)) {
    const base = username.split("'")[0].trim();
    const row = users.find(u => u.username === base) || users[0];
    console.log(`[sqli] tautology bypass via query: ${query}`);
    return row; // WHERE evaluated true — first matching row wins
  }
  // Normal (still exact-match) path of the same vulnerable query.
  return users.find(u => u.username === username && u.password === password) || null;
}

/* ---------------- Pages ---------------- */
function loginPage(msg = '') {
  return `<!doctype html><html><head><title>LabStack Login</title></head><body>
<h1>LabStack Portal</h1>
${msg ? `<p class="error">${msg}</p>` : ''}
<form method="POST" action="/login">
  <label>Username <input name="username" type="text"></label><br>
  <label>Password <input name="password" type="password"></label><br>
  <button type="submit">Sign in</button>
</form>
<script src="/static/app.js"></script>
</body></html>`;
}

function adminPage(user) {
  return `<!doctype html><html><head><title>Admin</title></head><body>
<h1>LAB-ADMIN-PANEL</h1>
<p>Welcome, ${user ? user.username : 'operator'}. Administrative console.</p>
<p>Marker: ADMIN_PANEL_REACHED</p>
<ul><li>Users: ${users.length}</li><li>Build: LabStack/1.0</li></ul>
</body></html>`;
}

/* ---------------- Server ---------------- */
const server = http.createServer((req, res) => {
  // PLANTED VULN 1 — stack fingerprint on every response.
  res.setHeader('X-Powered-By', 'LabStack/1.0');
  res.setHeader('Server', 'LabStack/1.0 (Node)');

  const rawPath = req.url.split('?')[0];
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(body);
  };

  /* Login form */
  if (req.method === 'GET' && rawPath === '/') {
    return send(200, 'text/html', loginPage());
  }

  /* PLANTED VULN 3 — SQLi auth (and weak credential admin/admin123) */
  if (req.method === 'POST' && rawPath === '/login') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const user = vulnerableLogin(form.get('username') || '', form.get('password') || '');
      if (!user) return send(401, 'text/html', loginPage('Invalid credentials'));
      const sid = crypto.randomBytes(16).toString('hex');
      sessions.set(sid, user.id);
      // PLANTED VULN 8 — session cookie with NO HttpOnly, NO Secure, NO SameSite.
      res.writeHead(302, {
        'Content-Type': 'text/html',
        'Set-Cookie': `session=${sid}; Path=/`,
        'Location': '/admin',
      });
      res.end(`Logged in as ${user.username}`);
    });
    return;
  }

  /*
   * PLANTED VULN 4 — ACL differential + path-confusion bypass.
   * The "ACL" matches the raw path literally: exactly "/admin" is denied,
   * "/admin/" falls through to the 404 handler, but variants that normalize
   * to /admin (double slash, percent-encoded 'a') slip past the check and
   * reach the admin page.
   */
  if (req.method === 'GET' && rawPath === '/admin') {
    return send(403, 'text/html', '<h1>403 Forbidden</h1><p>Access denied.</p>');
  }
  if (req.method === 'GET' && rawPath === '/admin/') {
    return send(404, 'text/html', '<h1>404 Not Found</h1>');
  }
  if (req.method === 'GET' && rawPath !== '/admin') {
    let normalized = rawPath;
    try { normalized = decodeURIComponent(rawPath); } catch { /* keep raw */ }
    normalized = normalized.replace(/\/{2,}/g, '/');
    if (normalized === '/admin') {
      return send(200, 'text/html', adminPage(null)); // bypass — no auth check either
    }
  }

  /* PLANTED VULN 5 — IDOR: any user's record, no auth, no ownership check. */
  if (req.method === 'GET' && rawPath === '/user') {
    const id = Number(url.searchParams.get('id'));
    const user = users.find(u => u.id === id);
    if (!user) return send(404, 'application/json', JSON.stringify({ error: 'no such user' }));
    return send(200, 'application/json', JSON.stringify({
      id: user.id, username: user.username, name: user.name, email: user.email, role: user.role,
    }));
  }

  /* PLANTED VULN 6 — reflected XSS: q echoed unescaped. */
  if (req.method === 'GET' && rawPath === '/search') {
    const q = url.searchParams.get('q') || '';
    return send(200, 'text/html',
      `<!doctype html><html><body><h1>Search results</h1><p>You searched for: ${q}</p></body></html>`);
  }

  /* PLANTED VULN 7 — fake leaked credential in the JS bundle. */
  if (req.method === 'GET' && rawPath === '/static/app.js') {
    return send(200, 'application/javascript',
`// LabStack frontend bundle (built 2026-10-01)
// TODO: move this out of the bundle before production!!
const API_KEY = "AKIA7G2KX9PLM4QR8STU";
const API_BASE = "/api";
console.log("LabStack app boot", API_BASE);
`);
  }

  return send(404, 'text/html', '<h1>404 Not Found</h1>');
});

server.listen(PORT, HOST, () => {
  console.log(`lab target listening on http://${HOST}:${PORT}`);
});
