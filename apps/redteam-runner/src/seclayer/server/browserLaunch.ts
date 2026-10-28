// How the headless browser is launched, in one place for the three things that launch it (the crawl
// renderer, the target screenshot and the DOM-XSS probe).
//
// It renders pages chosen by whoever submits a scan, so it has to be treated as the part of this
// process most likely to be attacked: a browser exploit is the one path from "someone submitted a
// URL" to code running on the server. Two things limit what that gets them.
//
//  1. NO SECRETS IN ITS ENVIRONMENT. Playwright starts the browser with the parent's whole
//     environment unless told otherwise, and this process's environment is DATABASE_URL,
//     ENCRYPTION_KEY, the Stripe and Resend keys and ORIGIN_AUTH_SECRET. The browser gets a short
//     allow-list instead.
//  2. A DIFFERENT USER. Chromium runs with --no-sandbox (a managed container cannot give it the
//     user namespaces its own sandbox needs), and the app itself runs as root so that nmap can open
//     raw sockets. Left alone, an exploited renderer would be root next to the app's memory. In the
//     Docker image SECLAYER_CHROMIUM_PATH points at a wrapper that drops to an unprivileged user
//     before executing the browser (see the Dockerfile), so the browser cannot read the app's
//     /proc entries or files.

// Only what a headless browser needs to start and find its fonts. Anything not listed is withheld.
const ENV_ALLOWLIST = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE'];

export function browserEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const v = source[key];
    if (v !== undefined) env[key] = v;
  }
  // A home the unprivileged user can write to (crash reports, caches). Not the app's.
  env.HOME = '/tmp';
  return env;
}

export function browserLaunchOptions(source: NodeJS.ProcessEnv = process.env) {
  const executablePath = source.SECLAYER_CHROMIUM_PATH?.trim();
  return {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: browserEnv(source),
    ...(executablePath ? { executablePath } : {}),
  };
}
