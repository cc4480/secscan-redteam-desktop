/**
 * DNS security checks — uses Cloudflare DNS-over-HTTPS (no key required).
 * Checks email authentication (SPF, DMARC, DKIM) and DNSSEC.
 *
 * Missing email security records allow attackers to send phishing emails
 * that appear to come from your domain — one of the most common attack vectors.
 */

import { randomUUID } from "node:crypto";
import type { ScanVulnerability } from "./scanner";

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 8_000;

function vuln(partial: Omit<ScanVulnerability, "id">): ScanVulnerability {
  return { id: randomUUID(), ...partial };
}

interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DnsAnswer[];
}

/**
 * Returns { answers, status } where:
 *   status  0 = NOERROR  (domain exists, record type may or may not exist)
 *   status  2 = SERVFAIL (resolver error)
 *   status  3 = NXDOMAIN (domain does not exist)
 *   status -1 = network / timeout failure (we don't know)
 *
 * Only report a "missing record" finding when status === 0, so transient
 * failures don't produce false-positive alerts.
 */
async function dnsQuery(
  name: string,
  type: "TXT" | "MX" | "A" | "DNSKEY" | "NS",
): Promise<{ answers: DnsAnswer[]; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}&ct=application/dns-json`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!res.ok) return { answers: [], status: -1 };
    const json = (await res.json()) as DohResponse;
    return { answers: json.Answer ?? [], status: json.Status };
  } catch {
    return { answers: [], status: -1 };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPF CHECK
// ─────────────────────────────────────────────────────────────────────────────

export async function checkSpf(hostname: string): Promise<ScanVulnerability[]> {
  const { answers, status } = await dnsQuery(hostname, "TXT");
  // status -1 means network failure — don't false-positive on transient errors
  if (status === -1) return [];
  const txtRecords = answers.map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));

  const spfRecord = txtRecords.find((r) => r.startsWith("v=spf1"));

  if (!spfRecord) {
    // Check if the domain has MX records (sends email) — if so, missing SPF is worse
    const { answers: mxAnswers } = await dnsQuery(hostname, "MX");
    const sendsMail = mxAnswers.length > 0;

    return [vuln({
      name: "Missing SPF Record — Email Spoofing Possible",
      severity: sendsMail ? "high" : "medium",
      category: "Email Security",
      description: `No SPF (Sender Policy Framework) record was found for ${hostname}. Without SPF, anyone can send emails that appear to come from @${hostname}. Attackers use this to send phishing emails to your customers, partners, and employees under your domain name, with no technical barrier to doing so.`,
      evidence: `DNS TXT query: ${hostname}\nStatus: NOERROR (domain exists)\nNo v=spf1 record found in ${answers.length} TXT record(s)${sendsMail ? `\nMX records present (${mxAnswers.length}) — domain actively sends email` : ""}`,
      solution: `Add a TXT record to your DNS for ${hostname}:\n"v=spf1 include:_spf.yourmailprovider.com ~all"\n\nReplace 'include:...' with your actual mail provider's SPF include. End with '-all' (hard fail) for strictest enforcement. Verify at: https://mxtoolbox.com/spf.aspx`,
      cweId: "CWE-290",
      cvssScore: sendsMail ? 7.5 : 5.3,
    })];
  }

  // SPF exists — check for dangerous configurations
  const vulns: ScanVulnerability[] = [];

  if (/\+all/.test(spfRecord)) {
    vulns.push(vuln({
      name: "SPF Record Uses +all (Allows Any Sender)",
      severity: "critical",
      category: "Email Security",
      description: `The SPF record for ${hostname} ends with "+all", which means ANY mail server on the internet is authorized to send email on behalf of your domain. This completely defeats the purpose of SPF and explicitly permits email spoofing from your domain.`,
      evidence: `TXT record: ${spfRecord}`,
      solution: 'Replace "+all" with "-all" (hard fail — reject unauthorized senders) or "~all" (soft fail — mark as spam). Use "-all" for strictest protection.',
      cweId: "CWE-290",
      cvssScore: 9.1,
    }));
  } else if (/\?all/.test(spfRecord)) {
    vulns.push(vuln({
      name: "SPF Record Uses ?all (Neutral — No Enforcement)",
      severity: "medium",
      category: "Email Security",
      description: `The SPF record uses "?all" which provides no actual enforcement — email from unauthorized senders is treated neutrally and will not be rejected or marked as spam. This offers no spoofing protection.`,
      evidence: `TXT record: ${spfRecord}`,
      solution: 'Change "?all" to "-all" (reject unauthorized senders) or at minimum "~all" (soft fail). Update to "-all" once you have verified all legitimate sending sources are included.',
      cweId: "CWE-290",
      cvssScore: 5.3,
    }));
  }

  // Check for too many DNS lookups (SPF 10-lookup limit)
  const lookupKeywords = ["include:", "a:", "mx:", "redirect=", "exists:"];
  const lookupCount = lookupKeywords.reduce((n, kw) => n + (spfRecord.split(kw).length - 1), 0);
  if (lookupCount > 8) {
    vulns.push(vuln({
      name: "SPF Record Exceeds DNS Lookup Limit",
      severity: "low",
      category: "Email Security",
      description: `The SPF record requires approximately ${lookupCount} DNS lookups, approaching or exceeding the RFC 7208 limit of 10. Records that exceed this limit result in a PermError, causing SPF to fail for all senders — meaning legitimate emails may be rejected or SPF protection silently disabled.`,
      evidence: `TXT record: ${spfRecord}\nEstimated DNS lookups: ~${lookupCount}`,
      solution: "Flatten your SPF record using a tool like dmarcian's SPF Surveyor. Replace nested includes with direct IP ranges using 'ip4:' and 'ip6:' mechanisms to reduce DNS lookups below 10.",
      cweId: "CWE-290",
    }));
  }

  return vulns;
}

// ─────────────────────────────────────────────────────────────────────────────
// DMARC CHECK
// ─────────────────────────────────────────────────────────────────────────────

export async function checkDmarc(hostname: string): Promise<ScanVulnerability[]> {
  const dmarcHost = `_dmarc.${hostname}`;
  const { answers, status } = await dnsQuery(dmarcHost, "TXT");
  if (status === -1) return [];
  const txtRecords = answers.map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));

  const dmarcRecord = txtRecords.find((r) => r.startsWith("v=DMARC1"));

  if (!dmarcRecord) {
    return [vuln({
      name: "Missing DMARC Record — No Email Authentication Enforcement",
      severity: "high",
      category: "Email Security",
      description: `No DMARC (Domain-based Message Authentication, Reporting & Conformance) record exists for ${hostname}. Without DMARC, even if SPF and DKIM are configured, there is no policy telling receiving mail servers what to do with messages that fail authentication. Attackers can bypass SPF/DKIM using the "From" header spoofing that DMARC is specifically designed to prevent.`,
      evidence: `DNS TXT query: _dmarc.${hostname}\nStatus: NOERROR (domain exists)\nNo v=DMARC1 record found in ${answers.length} TXT record(s)`,
      solution: `Add a TXT record for _dmarc.${hostname}:\n"v=DMARC1; p=quarantine; rua=mailto:dmarc@${hostname}; ruf=mailto:dmarc@${hostname}; fo=1"\n\nStart with p=none (monitoring) and progress to p=quarantine then p=reject once you verify legitimate email flows. Use https://dmarcian.com to monitor reports.`,
      cweId: "CWE-290",
      cvssScore: 7.5,
    })];
  }

  const vulns: ScanVulnerability[] = [];

  // Check policy strength
  const policyMatch = /\bp=(\w+)/i.exec(dmarcRecord);
  const policy = policyMatch?.[1]?.toLowerCase() ?? "none";

  if (policy === "none") {
    vulns.push(vuln({
      name: "DMARC Policy Set to None (Monitoring Only — No Enforcement)",
      severity: "medium",
      category: "Email Security",
      description: `The DMARC policy is p=none, which means emails that fail authentication are delivered normally with no action taken. This is appropriate for initial rollout and monitoring but provides zero spoofing protection. Attackers can still send spoofed emails from your domain that reach recipients' inboxes.`,
      evidence: `TXT record: ${dmarcRecord}`,
      solution: 'After reviewing DMARC aggregate reports (rua=) to ensure all legitimate email is passing authentication, progress to p=quarantine then p=reject. p=reject provides the strongest protection — spoofed emails are outright rejected.',
      cweId: "CWE-290",
      cvssScore: 5.3,
    }));
  }

  // Check for missing reporting addresses
  if (!/\brua=/.test(dmarcRecord)) {
    vulns.push(vuln({
      name: "DMARC Record Missing Aggregate Report Address (rua=)",
      severity: "info",
      category: "Email Security",
      description: "The DMARC record has no aggregate reporting address (rua=). Without reports, you cannot see which mail servers are sending email on behalf of your domain or monitor for spoofing attempts.",
      evidence: `TXT record: ${dmarcRecord}`,
      solution: `Add rua=mailto:dmarc@${hostname} (or use a DMARC monitoring service like Postmark, Dmarcian, or Proofpoint) to receive daily aggregate reports about your email authentication.`,
      cweId: "CWE-778",
    }));
  }

  return vulns;
}

// ─────────────────────────────────────────────────────────────────────────────
// DKIM CHECK
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_DKIM_SELECTORS = [
  // Standard / service-specific selectors
  "default", "google", "mail", "smtp", "k1", "k2",
  "selector1", "selector2", "email", "mailjet", "mandrill",
  "sendgrid", "pm", "s1", "s2", "dkim", "key1", "key2",
  "mxvault", "everlytickey1", "everlytickey2", "litesrv",
  // Additional common selectors
  "m1", "m2", "dkim1", "dkim2", "mx", "mailgun", "cm",
  "proddkim1024", "sf2", "zendesk1", "zendesk2",
  // Date-based selectors — Google Workspace, Microsoft 365, and many
  // enterprise mail platforms rotate keys with date-stamped selectors.
  // We probe the most recent windows; note that missing these does NOT
  // mean DKIM is absent — only that we couldn't find the active selector.
  "20221201", "20230601", "20231201",
  "20240101", "20240601", "20241201",
  "20250101", "20250601",
];

export async function checkDkim(hostname: string): Promise<ScanVulnerability[]> {
  // Try each common selector in parallel
  const results = await Promise.allSettled(
    COMMON_DKIM_SELECTORS.map((selector) =>
      dnsQuery(`${selector}._domainkey.${hostname}`, "TXT"),
    ),
  );

  const foundAny = results.some(
    (r) => r.status === "fulfilled" && r.value.answers.length > 0,
  );
  // Only report if at least one query returned a valid DNS response (status 0).
  // If ALL queries timed out / errored, we have no basis for a finding.
  const anyQuerySucceeded = results.some(
    (r) => r.status === "fulfilled" && r.value.status === 0,
  );

  if (!foundAny && anyQuerySucceeded) {
    return [vuln({
      name: "No DKIM Records Found",
      severity: "low",
      category: "Email Security",
      description: `No DKIM (DomainKeys Identified Mail) TXT records were found for ${hostname} under ${COMMON_DKIM_SELECTORS.length} commonly used selectors. DKIM adds a cryptographic signature to outgoing emails, allowing recipients to verify they weren't tampered with in transit. Without DKIM, your emails are more likely to be marked as spam and DMARC enforcement is weakened.`,
      evidence: `Checked selectors: ${COMMON_DKIM_SELECTORS.slice(0, 8).join(", ")}, and ${COMMON_DKIM_SELECTORS.length - 8} more — none returned a valid DKIM record.`,
      solution: "Enable DKIM signing in your email service provider (Google Workspace, Microsoft 365, SendGrid, Mailgun, etc.) and publish the provided TXT record under [selector]._domainkey.yourdomain.com. The exact steps depend on your mail provider.",
      cweId: "CWE-345",
    })];
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// DNSSEC CHECK
// ─────────────────────────────────────────────────────────────────────────────

export async function checkDnssec(hostname: string): Promise<ScanVulnerability[]> {
  const { answers, status } = await dnsQuery(hostname, "DNSKEY");
  if (status === -1) return [];
  if (answers.length === 0) {
    return [vuln({
      name: "DNSSEC Not Enabled",
      severity: "info",
      category: "DNS Security",
      description: `DNSSEC is not configured for ${hostname}. Without DNSSEC, DNS responses can be forged or tampered with in transit (DNS cache poisoning / Kaminsky attack). Attackers can redirect your domain's traffic to malicious servers without users or servers being able to detect it.`,
      evidence: `No DNSKEY records found for ${hostname}.`,
      solution: "Enable DNSSEC through your domain registrar. Most major registrars (Cloudflare, AWS Route 53, Google Domains) offer one-click DNSSEC. Your DNS hosting provider must also support signed zones. This requires coordination between your registrar and DNS provider.",
      cweId: "CWE-350",
    })];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cloud-hosting platforms where the subdomain owner has NO DNS control.
 * The apex domain is managed by the platform, so DMARC/SPF/DKIM records
 * cannot be configured by the app owner — flagging their absence is a
 * false positive with zero actionability.
 *
 * Each entry is matched as a suffix: "foo.vercel.app" matches ".vercel.app".
 */
const UNCONTROLLED_DNS_PLATFORMS = [
  ".replit.app",
  ".replit.dev",
  ".repl.co",
  ".vercel.app",
  ".netlify.app",
  ".github.io",
  ".fly.dev",
  ".onrender.com",
  ".render.com",
  ".railway.app",
  ".up.railway.app",
  ".azurewebsites.net",
  ".azurestaticapps.net",
  ".workers.dev",
  ".pages.dev",
  ".web.app",
  ".firebaseapp.com",
  ".amplifyapp.com",
  ".surge.sh",
  ".glitch.me",
  ".codesandbox.io",
  ".stackblitz.io",
  ".cloudflare.dev",
  ".deno.dev",
  ".val.run",
  ".brev.sh",
];

/** Returns true when the hostname is a subdomain on a managed hosting platform. */
function isUncontrolledPlatformSubdomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return UNCONTROLLED_DNS_PLATFORMS.some((suffix) => lower.endsWith(suffix));
}

export async function checkDnsSecurity(targetUrl: string): Promise<ScanVulnerability[]> {
  let hostname: string;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return [];
  }

  // Don't run DNS checks on IP addresses
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === "localhost") {
    return [];
  }

  // Skip email-auth checks for cloud-hosting subdomains where the app owner
  // has no DNS control.  Adding DMARC/SPF/DKIM records to these domains is
  // impossible — the findings would be unfixable false positives.
  if (isUncontrolledPlatformSubdomain(hostname)) {
    return [];
  }

  // Run SPF and DMARC first so we can decide whether to suppress DKIM brute-force.
  const [spf, dmarc] = await Promise.allSettled([
    checkSpf(hostname),
    checkDmarc(hostname),
  ]);

  const dmarcVulns = dmarc.status === "fulfilled" ? dmarc.value : [];

  // DMARC is "enforcing" when there is no "Missing DMARC" finding AND no
  // "p=none" finding.  An enforcing DMARC policy (p=quarantine or p=reject)
  // requires at least one aligned authentication mechanism — which means the
  // domain almost certainly has DKIM configured under a non-standard selector
  // (e.g. a date-based key like "20230601") that our brute-force list doesn't
  // cover.  Reporting "No DKIM found" in that case is a false positive.
  const dmarcIsEnforcing =
    !dmarcVulns.some((v) => v.name.includes("Missing DMARC")) &&
    !dmarcVulns.some((v) =>
      v.name.toLowerCase().includes("none") ||
      v.name.toLowerCase().includes("monitoring only"),
    );

  const [dkim, dnssec] = await Promise.allSettled([
    // Skip DKIM selector probing when DMARC is enforcing — the domain has DKIM
    // configured; we just can't discover the selector by brute-force.
    dmarcIsEnforcing ? Promise.resolve([]) : checkDkim(hostname),
    checkDnssec(hostname),
  ]);

  return [
    ...(spf.status === "fulfilled" ? spf.value : []),
    ...dmarcVulns,
    ...(dkim.status === "fulfilled" ? dkim.value : []),
    ...(dnssec.status === "fulfilled" ? dnssec.value : []),
  ];
}
