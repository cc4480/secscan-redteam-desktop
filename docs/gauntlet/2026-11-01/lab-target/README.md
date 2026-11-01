# Lab target — planted-vulnerability ground truth (verified by Cho-zen1, 2026-11-01)

Server: `server.js` (Node stdlib only) on http://127.0.0.1:8080 — deliberately vulnerable. Score the fleet's findings against this list.

| # | Planted weakness | Proving request | Verified receipt |
|---|---|---|---|
| 1 | Stack fingerprint leak | `GET /` | `X-Powered-By: LabStack/1.0`, `Server: LabStack/1.0 (Node)` |
| 2 | SQL injection in login (tautology bypass) | `POST /login` username=`admin' OR '1'='1' -- ` | server log: `[sqli] tautology bypass via query: SELECT * FROM users WHERE username = 'admin' OR '1'='1' -- ' ...` → logged in as admin |
| 3 | Weak credentials | `POST /login` admin/admin123 | `302 → /admin`, "Logged in as admin", session cookie set |
| 4 | Admin ACL exact-match differential | `GET /admin` → 403; `GET /admin/` → 404 | both status codes confirmed |
| 5 | Admin ACL path-confusion bypass | `GET /%61dmin` | `200` (admin page without auth) |
| 6 | IDOR — user records, no auth/ownership check | `GET /user?id=2` | alice's full record (name/email/role) returned unauthenticated |
| 7 | Reflected XSS | `GET /search?q=<script>alert(1)</script>` | payload reflected unescaped |
| 8 | Credential leaked in JS bundle | `GET /static/app.js` | `API_KEY` string present in bundle |
| 9 | Session cookie without HttpOnly/Secure flags | login response `Set-Cookie` | planted by construction in server.js |

Users: admin/admin123 (admin), alice/wonderland, bob/builder.
