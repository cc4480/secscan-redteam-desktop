import net from "net";
import { installEgressGuard } from "./browserEgress.js";
import { browserLaunchOptions } from "./browserLaunch.js";
export function isRenderingEnabled() {
    return process.env.ENABLE_BROWSER_RENDERING === "true";
}
// Target screenshotting is a separate opt-in from crawl rendering: an operator
// may want a visual of the landing page without paying for a full JS crawl of
// every discovered endpoint. Both rely on the same headless browser.
export function isScreenshotEnabled() {
    return process.env.ENABLE_TARGET_SCREENSHOT === "true";
}
// Cheap synchronous pre-check that rejects obviously-internal targets before a
// browser is launched. NOT the SSRF boundary — it never resolves DNS; the real
// enforcement is installEgressGuard (browserEgress.ts) on every request.
export function hostLooksInternal(hostname) {
    const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal"))
        return true;
    if (net.isIPv4(h)) {
        const [a, b] = h.split(".").map(Number);
        if (a === 127 || a === 10 || a === 0 || a >= 224)
            return true;
        if (a === 172 && b >= 16 && b <= 31)
            return true;
        if (a === 192 && b === 168)
            return true;
        if (a === 169 && b === 254)
            return true;
        if (a === 100 && b >= 64 && b <= 127)
            return true;
    }
    if (net.isIPv6(h)) {
        if (h === "::1" || h === "::")
            return true;
        if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd"))
            return true;
    }
    return false;
}
export async function renderPage(url, extraHeaders, timeoutMs = 12000) {
    if (!isRenderingEnabled())
        return null;
    let pw;
    try {
        // Variable specifier keeps this out of the TS/esbuild dependency graph, so
        // the project builds and runs without playwright installed.
        const pkg = "playwright";
        pw = await import(pkg);
    }
    catch {
        console.warn('[render] ENABLE_BROWSER_RENDERING is set but "playwright" is not installed; skipping render.');
        return null;
    }
    let browser;
    try {
        browser = await pw.chromium.launch(browserLaunchOptions());
        const ctx = await browser.newContext({ extraHTTPHeaders: extraHeaders, ignoreHTTPSErrors: true, serviceWorkers: "block" });
        const page = await ctx.newPage();
        // Every request (navigation, subresource, redirect hop) goes through the
        // DNS-pinned SSRF-safe fetch; see browserEgress.ts.
        await installEgressGuard(page);
        const origin = new URL(url).origin;
        const requested = new Set();
        page.on("request", (req) => {
            try {
                const u = req.url();
                if (new URL(u).origin === origin)
                    requested.add(u);
            }
            catch { }
        });
        const resp = await page
            .goto(url, { waitUntil: "networkidle", timeout: timeoutMs })
            .catch(() => null);
        const html = await page.content().catch(() => "");
        let status = null;
        let headers = {};
        try {
            status = resp ? resp.status() : null;
            const h = resp ? resp.headers() : {};
            for (const [k, v] of Object.entries(h || {}))
                headers[k.toLowerCase()] = String(v);
        }
        catch {
            /* best effort — the render is still useful without them */
        }
        const finalUrl = (() => {
            try {
                return page.url();
            }
            catch {
                return null;
            }
        })();
        return { html, requestedUrls: [...requested], status, headers, finalUrl };
    }
    catch (err) {
        console.warn(`[render] headless render failed: ${err?.message || err}`);
        return null;
    }
    finally {
        try {
            await browser?.close();
        }
        catch { }
    }
}
// Best-effort visual capture of the target's landing page. Returns null on ANY
// problem (feature disabled, playwright/browser missing, SSRF-blocked host,
// navigation/timeout error) so a capture failure can never fail the scan.
//
// Same SSRF hardening as renderPage(): every request the page makes is proxied
// through the DNS-pinned guardedFetch (browserEgress.ts), so a redirect,
// subresource, or hostname resolving to an internal address cannot pull the
// browser into internal infrastructure.
export async function captureScreenshot(url, extraHeaders, timeoutMs = 15000) {
    if (!isScreenshotEnabled())
        return null;
    // Reject non-http(s) and obviously-internal targets before launching anything.
    let origin;
    try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:")
            return null;
        if (hostLooksInternal(u.hostname))
            return null;
        origin = u.origin;
    }
    catch {
        return null;
    }
    let pw;
    try {
        const pkg = "playwright";
        pw = await import(pkg);
    }
    catch {
        console.warn('[render] ENABLE_TARGET_SCREENSHOT is set but "playwright" is not installed; skipping screenshot.');
        return null;
    }
    const width = 1280;
    const height = 800;
    let browser;
    try {
        browser = await pw.chromium.launch(browserLaunchOptions());
        const ctx = await browser.newContext({
            viewport: { width, height },
            extraHTTPHeaders: extraHeaders,
            ignoreHTTPSErrors: true,
            serviceWorkers: "block",
        });
        const page = await ctx.newPage();
        // Every request (navigation, subresource, redirect hop) goes through the
        // DNS-pinned SSRF-safe fetch; see browserEgress.ts.
        await installEgressGuard(page);
        // Refuse to end up on an internal origin after redirects.
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => { });
        try {
            const landed = new URL(page.url());
            if (hostLooksInternal(landed.hostname))
                return null;
        }
        catch { }
        // Settle time for above-the-fold content — long enough for a client-rendered
        // SPA to fire its initial API call(s) and re-render before the shot, capped
        // so a slow page can't hang. 1500ms was too thin: a target whose first
        // render depends on an auth/session check (common for SPAs that gate even
        // the public landing page) could still be mid-request at that point, and
        // the resulting screenshot would show a transient loading/error state as if
        // it were the page's real content. 3000ms stays comfortably under the
        // quarter-of-timeoutMs ceiling at the 15s default, so it's the binding cap
        // in practice, not the ceiling.
        await page.waitForTimeout(Math.min(3000, Math.floor(timeoutMs / 4)));
        // Viewport-only JPEG (not fullPage) to bound the encoded size.
        const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
        if (!buf || buf.length === 0)
            return null;
        return {
            dataUri: `data:image/jpeg;base64,${buf.toString("base64")}`,
            capturedAt: new Date().toISOString(),
            width,
            height,
        };
    }
    catch (err) {
        console.warn(`[render] screenshot capture failed: ${err?.message || err}`);
        return null;
    }
    finally {
        try {
            await browser?.close();
        }
        catch { }
    }
}
