import { describe, it, expect } from "vitest";
import { detectTechnologies } from "./techFingerprint.js";

describe("detectTechnologies — server headers", () => {
  it("detects Nginx", () =>
    expect(detectTechnologies({ server: "nginx/1.24.0" }, "")).toContain("Nginx"));
  it("detects Apache", () =>
    expect(detectTechnologies({ server: "Apache/2.4.58 (Ubuntu)" }, "")).toContain("Apache"));
  it("detects IIS", () =>
    expect(detectTechnologies({ server: "Microsoft-IIS/10.0" }, "")).toContain("IIS"));
  it("detects Cloudflare from Server header", () =>
    expect(detectTechnologies({ server: "cloudflare" }, "")).toContain("Cloudflare"));
  it("detects Vercel from Server header", () =>
    expect(detectTechnologies({ server: "Vercel" }, "")).toContain("Vercel"));
});

describe("detectTechnologies — CDN / infra headers", () => {
  it("detects Cloudflare from CF-Ray", () =>
    expect(detectTechnologies({ "cf-ray": "8abc123def-LHR" }, "")).toContain("Cloudflare"));
  it("detects Vercel from X-Vercel-Id", () =>
    expect(detectTechnologies({ "x-vercel-id": "iad1::abc" }, "")).toContain("Vercel"));
  it("detects Netlify from X-Netlify", () =>
    expect(detectTechnologies({ "x-netlify": "1" }, "")).toContain("Netlify"));
  it("detects Fly.io from fly-request-id", () =>
    expect(detectTechnologies({ "fly-request-id": "abc-123" }, "")).toContain("Fly.io"));
  it("detects Railway from x-railway-request-id", () =>
    expect(detectTechnologies({ "x-railway-request-id": "abc" }, "")).toContain("Railway"));
  it("detects Render from x-render-origin-server", () =>
    expect(detectTechnologies({ "x-render-origin-server": "Render" }, "")).toContain("Render"));
  it("detects AWS CloudFront from x-amz-cf-id", () =>
    expect(detectTechnologies({ "x-amz-cf-id": "abc" }, "")).toContain("AWS CloudFront"));
  it("detects GitHub Pages from x-github-request-id", () =>
    expect(detectTechnologies({ "x-github-request-id": "abc" }, "")).toContain("GitHub Pages"));
});

describe("detectTechnologies — X-Powered-By header", () => {
  it("detects PHP", () =>
    expect(detectTechnologies({ "x-powered-by": "PHP/8.2" }, "")).toContain("PHP"));
  it("detects Express.js", () =>
    expect(detectTechnologies({ "x-powered-by": "Express" }, "")).toContain("Express.js"));
  it("detects ASP.NET", () =>
    expect(detectTechnologies({ "x-powered-by": "ASP.NET" }, "")).toContain("ASP.NET"));
  it("detects Next.js", () =>
    expect(detectTechnologies({ "x-powered-by": "Next.js" }, "")).toContain("Next.js"));
  it("detects Django", () =>
    expect(detectTechnologies({ "x-powered-by": "Django" }, "")).toContain("Django"));
});

describe("detectTechnologies — cookie-based detection", () => {
  it("detects PHP from PHPSESSID cookie", () =>
    expect(detectTechnologies({ "set-cookie": "PHPSESSID=abc" }, "")).toContain("PHP"));
  it("detects ASP.NET from ASP.NET_SessionId cookie", () =>
    expect(detectTechnologies({ "set-cookie": "ASP.NET_SessionId=abc" }, "")).toContain("ASP.NET"));
  it("detects Laravel from laravel_session cookie", () =>
    expect(detectTechnologies({ "set-cookie": "laravel_session=abc" }, "")).toContain("Laravel"));
  it("detects Django from csrftoken cookie", () =>
    expect(detectTechnologies({ "set-cookie": "csrftoken=abc" }, "")).toContain("Django"));
});

describe("detectTechnologies — HTML: CMS platforms", () => {
  it("detects WordPress from wp-content path", () =>
    expect(detectTechnologies({}, `<link href="/wp-content/themes/main.css"/>`)).toContain("WordPress"));
  it("detects WordPress from meta generator", () =>
    expect(detectTechnologies({}, `<meta name="generator" content="WordPress 6.5"/>`)).toContain("WordPress"));
  it("detects Drupal from Drupal.behaviors in script", () =>
    expect(detectTechnologies({}, `<script>Drupal.behaviors.init = function(){}</script>`)).toContain("Drupal"));
  it("detects Shopify from cdn.shopify.com", () =>
    expect(detectTechnologies({}, `<script src="https://cdn.shopify.com/s/files/foo.js"></script>`)).toContain("Shopify"));
  it("detects Wix from static.wixstatic.com", () =>
    expect(detectTechnologies({}, `<img src="https://static.wixstatic.com/logo.png"/>`)).toContain("Wix"));
  it("detects Webflow from webflow.com reference", () =>
    expect(detectTechnologies({}, `<script src="https://uploads-ssl.webflow.com/js/webflow.js"></script>`)).toContain("Webflow"));
});

describe("detectTechnologies — HTML: AI-builder / BaaS platforms", () => {
  it("detects Lovable from lovable.dev script", () =>
    expect(detectTechnologies({}, `<script src="https://lovable.dev/client.js"></script>`)).toContain("Lovable"));
  it("detects Bolt.new from stackblitz.io reference", () =>
    expect(detectTechnologies({}, `<meta content="https://stackblitz.io/embed"/>`)).toContain("Bolt.new"));
  it("detects Supabase from supabase.co URL", () =>
    expect(detectTechnologies({}, `const url = 'https://abc.supabase.co'`)).toContain("Supabase"));
  it("detects Firebase from firebaseConfig", () =>
    expect(detectTechnologies({}, `const firebaseConfig = { apiKey: "abc" }`)).toContain("Firebase"));
});

describe("detectTechnologies — HTML: JS frameworks", () => {
  it("detects Next.js from __NEXT_DATA__", () =>
    expect(detectTechnologies({}, `<script id="__NEXT_DATA__" type="application/json">`)).toContain("Next.js"));
  it("detects React from data-reactroot", () =>
    expect(detectTechnologies({}, `<div id="root" data-reactroot=""></div>`)).toContain("React"));
  it("detects Vue.js from __vue_app__", () =>
    expect(detectTechnologies({}, `<div id="app" __vue_app__></div>`)).toContain("Vue.js"));
  it("detects Angular from ng-version", () =>
    expect(detectTechnologies({}, `<app-root ng-version="17.0.0"></app-root>`)).toContain("Angular"));
  it("detects Svelte from SvelteKit marker", () =>
    expect(detectTechnologies({}, `<!-- SvelteKit -->`)).toContain("Svelte"));
  it("detects Remix from __remixContext", () =>
    expect(detectTechnologies({}, `window.__remixContext = {}`)).toContain("Remix"));
  it("detects Astro from astro-island", () =>
    expect(detectTechnologies({}, `<astro-island uid="abc"/>`)).toContain("Astro"));
  it("detects Nuxt.js from __nuxt__", () =>
    expect(detectTechnologies({}, `<script>window.__nuxt__ = {}</script>`)).toContain("Nuxt.js"));
});

describe("detectTechnologies — HTML: analytics", () => {
  it("detects Google Analytics from gtag(", () =>
    expect(detectTechnologies({}, `gtag('config', 'G-ABC')`)).toContain("Google Analytics"));
  it("detects Sentry from Sentry.init", () =>
    expect(detectTechnologies({}, `Sentry.init({ dsn: "https://abc@sentry.io" })`)).toContain("Sentry"));
  it("detects Stripe from js.stripe.com", () =>
    expect(detectTechnologies({}, `<script src="https://js.stripe.com/v3/"></script>`)).toContain("Stripe"));
  it("detects Intercom from intercomSettings", () =>
    expect(detectTechnologies({}, `window.intercomSettings = { app_id: "abc" }`)).toContain("Intercom"));
});

describe("detectTechnologies — edge cases", () => {
  it("returns empty array for empty inputs", () =>
    expect(detectTechnologies({}, "")).toEqual([]));
  it("header matching is case-insensitive", () =>
    expect(detectTechnologies({ "Server": "nginx" }, "")).toContain("Nginx"));
  it("header keys are case-insensitive (all-caps)", () =>
    expect(detectTechnologies({ "CF-RAY": "abc123" }, "")).toContain("Cloudflare"));
  it("deduplicates when multiple signals point to same tech (Cloudflare)", () => {
    const result = detectTechnologies({ server: "cloudflare", "cf-ray": "abc" }, "");
    expect(result.filter((t) => t === "Cloudflare")).toHaveLength(1);
  });
  it("deduplicates WordPress detected from both header and HTML", () => {
    const result = detectTechnologies(
      { link: `<https://example.com/wp-json>; rel="https://api.w.org/"` },
      `<link href="/wp-content/style.css"/>`,
    );
    expect(result.filter((t) => t === "WordPress")).toHaveLength(1);
  });
});
