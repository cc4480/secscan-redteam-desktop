/**
 * Token auth for the UI server (v0.22.0).
 *
 * The UI controls live pentest tooling, so it is a privileged console:
 *  - binds loopback only by default (see server.ts)
 *  - a random 256-bit token is generated at startup and printed to the
 *    terminal — it is never written to disk
 *  - every /api/* call needs it as `Authorization: Bearer <token>` or the
 *    HttpOnly SameSite=Strict cookie set by POST /api/auth
 *  - the dashboard page itself is gated the same way
 */
import type { IncomingMessage } from "node:http";
export declare const UI_COOKIE = "redteam_ui";
export declare function generateToken(): string;
/** Constant-time token check against bearer header or auth cookie. */
export declare function tokensEqual(a: string, b: string): boolean;
export declare function isAuthorized(req: IncomingMessage, token: string): boolean;
export declare function assertStrongToken(token: string): void;
/** Set-Cookie value for a successful POST /api/auth. */
export declare function authCookie(token: string): string;
