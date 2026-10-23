/**
 * Command target extraction — the static text scan of zimzilla/scope.py.
 *
 * The scan tokenises a shell command and pulls out the network targets
 * it names: URLs, host:port pairs, IPs and CIDRs are unambiguous;
 * impacket `domain/user@host` targets and UNC paths are peeled off
 * before the filename rules can eat them; bare dotted hostnames count
 * only in network-tool context or with a TLD that is never a file
 * extension, so ordinary file arguments (report.json) are not mistaken
 * for hosts. It is a text scan, not a sandbox: it does not run the
 * shell, resolve DNS, or observe what a process does after it starts.
 */
import { IPV4_RE, IPV4_CIDR_RE } from "./scope-ip.js";
// ---------------------------------------------------------------------------
// Command target extraction (port of scope.py's static text scan)
// ---------------------------------------------------------------------------

/** Tools whose arguments commonly name a network target (Python NETWORK_TOOLS). */
export const NETWORK_TOOLS: ReadonlySet<string> = new Set([
  "curl", "wget", "nmap", "ffuf", "gobuster", "feroxbuster", "nikto",
  "masscan", "nc", "netcat", "ncat", "ssh", "scp", "sftp", "socat",
  "dig", "host", "nslookup", "whois", "traceroute", "tracepath", "ping",
  "hydra", "sqlmap", "wfuzz", "dirb", "dnsrecon", "amass", "subfinder",
  "httpx", "httprobe", "nuclei", "whatweb", "wpscan", "smbclient",
  "redis-cli", "mongo", "psql", "mysql", "telnet", "openssl", "arjun",
  "katana", "gau", "waybackurls", "dalfox", "commix", "xsser",
  "nxc", "netexec", "crackmapexec", "certipy", "bloodhound-python",
  "rusthound", "ldapsearch", "ldapmodify", "ldapadd", "kerbrute",
  "rpcclient", "smbmap", "enum4linux", "enum4linux-ng", "windapsearch",
  "gpp-decrypt", "mitm6", "responder", "ntlmrelayx.py",
  "psexec.py", "wmiexec.py", "smbexec.py", "atexec.py", "dcomexec.py",
  "secretsdump.py", "GetUserSPNs.py", "GetNPUsers.py", "GetADUsers.py",
  "lookupsid.py", "samrdump.py", "rpcdump.py", "reg.py", "mssqlclient.py",
  "impacket-psexec", "impacket-wmiexec", "impacket-secretsdump",
  "impacket-GetUserSPNs", "impacket-GetNPUsers", "impacket-lookupsid",
  "impacket-samrdump", "impacket-rpcdump", "impacket-ntlmrelayx",
]);

/** Shell tokens that are never targets. */
const SHELL_NOISE: ReadonlySet<string> = new Set([
  "|", "||", "&&", "&", ";", ">", ">>", "<", "2>", "2>>", "(", ")",
  "sudo", "env", "time", "timeout", "xargs", "watch", "do", "then",
]);

const URL_RE = /\b([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\s'"|;&)]+)/g;
const HOSTPORT_RE = /^([a-zA-Z0-9_.\-]+):(\d{1,5})$/;
const HOSTNAME_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})+\.?$/;
export const SUBSTITUTION_RE = /\$\(|\$\{|\$[A-Za-z_]|`/;
const SUBSTITUTION_SPAN_RE = /\$\([^)]*\)|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|`[^`]*`/g;
const FLAG_RE = /^--?[A-Za-z]/;
const VERSIONISH_RE = /^\d+(\.\d+)*$/;
const AT_HOST_RE = /@([a-zA-Z0-9_.\-]+)\.?$/;
const UNC_RE = /^[\\/]{2}([a-zA-Z0-9_.\-]+)/;
const IMPACKET_DOMAIN_RE = /^([a-zA-Z0-9_\-]+(?:\.[a-zA-Z0-9_\-]+)+)\//;
const PIPE_SPLIT_RE = /\|\||&&|[|;&\n]/;
const PREFIX_WORDS: ReadonlySet<string> = new Set([
  "sudo", "env", "time", "timeout", "nohup", "command", "xargs", "watch",
]);

/**
 * TLDs that are never file extensions (Python `_NEVER_A_FILE_EXT_TLDS`),
 * including internal AD suffixes. A bare dotted token ending in one of
 * these counts as a hostname even without a network tool in the command;
 * any other bare dotted token (report.json) counts only in network-tool
 * context, so ordinary file arguments are not mistaken for hosts.
 */
export const NEVER_FILE_EXT_TLDS: ReadonlySet<string> = new Set([
  "com", "net", "org", "io", "co", "dev", "app", "cloud", "xyz", "online",
  "site", "tech", "store", "info", "biz", "me", "tv", "cc", "ru", "cn",
  "uk", "de", "fr", "jp", "au", "ca", "nl", "eu", "us", "gov", "edu",
  "mil", "ai", "gg", "to", "name", "pro", "mobi", "asia", "ac", "am",
  "br", "ch", "es", "fi", "gr", "hk", "id", "ie", "il", "it", "kr",
  "mx", "my", "no", "nz", "ph", "pl", "pt", "ro", "se", "sg", "tr",
  "tw", "ua", "vn", "za",
  "local", "internal", "corp", "lan", "intranet", "home", "ad", "ds",
  "loc", "dom",
]);

/**
 * The command with every shell-substitution span removed (Python
 * `_strip_substitutions`): the static skeleton known before the shell runs.
 *
 * @param command - The raw command text.
 * @returns The command with $(...), ${...}, $var and `...` spans blanked.
 */
export function stripSubstitutions(command: string): string {
  return command.replace(SUBSTITUTION_SPAN_RE, " ");
}

/**
 * True if any segment of the command invokes a known network binary
 * (Python `command_uses_network_tool`): the command line is split on shell
 * separators, leading assignments and prefix words (sudo/env/timeout/…)
 * are stripped, and the binary's basename is compared to NETWORK_TOOLS.
 *
 * @param command - The raw command text.
 * @returns Whether a network tool is invoked anywhere in the command.
 */
export function commandUsesNetworkTool(command: string): boolean {
  for (const segment of command.split(PIPE_SPLIT_RE)) {
    const words = segment.trim().split(/\s+/).filter((w) => w.length > 0);
    while (words.length > 0 && words[0].includes("=") && !words[0].startsWith("-")) words.shift();
    while (words.length > 0 && PREFIX_WORDS.has(words[0])) words.shift();
    if (words.length === 0) continue;
    const binary = words[0].split("/").pop() ?? "";
    if (NETWORK_TOOLS.has(binary)) return true;
  }
  return false;
}

/**
 * Best-effort extraction of network targets from a shell command (Python
 * `extract_targets`). Unambiguous targets (URLs, host:port, IPs, CIDRs,
 * impacket and UNC forms) are always returned; bare dotted hostnames only
 * in network-tool context or with a never-a-file-extension TLD.
 *
 * @param command - The raw command text.
 * @param networkContext - Whether the command runs a known network tool;
 *   computed from the command when omitted.
 * @returns The extracted target hosts, in order of appearance.
 */
export function extractTargets(command: string, networkContext?: boolean): string[] {
  const inNetworkContext = networkContext ?? commandUsesNetworkTool(command);
  const targets: string[] = [];

  // 1. Explicit URLs — unambiguous.
  for (const m of command.matchAll(URL_RE)) {
    const rest = m[2];
    const host = rest.split("/")[0].split("?")[0].split("@").pop()?.split(":")[0] ?? "";
    if (host) targets.push(host);
  }

  // 2. Token scan.
  for (const raw of command.split(/\s+/)) {
    const tok = raw.trim().replace(/^['"`,]+/, "").replace(/['"`,]+$/, "");
    if (!tok || SHELL_NOISE.has(tok)) continue;

    if (FLAG_RE.test(tok)) {
      // Flags can still embed a URL (e.g. --url=https://x).
      if (tok.includes("=")) {
        const val = tok.split("=", 2)[1] ?? "";
        const m = /([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\s'"|;&)]+)/.exec(val);
        if (m) {
          const h = m[2].split("/")[0].split(":")[0];
          if (h) targets.push(h);
        }
      }
      continue;
    }

    const hostPort = HOSTPORT_RE.exec(tok);
    if (hostPort) {
      targets.push(hostPort[1]);
      continue;
    }

    if (IPV4_CIDR_RE.test(tok)) {
      targets.push(tok.split("/")[0]);
      continue;
    }

    if (IPV4_RE.test(tok)) {
      targets.push(tok);
      continue;
    }

    if (tok.includes("://")) {
      const h = tok.split("://", 2)[1].split("/")[0].split(":")[0];
      if (h) targets.push(h);
      continue;
    }

    // Impacket target syntax: `corp.local/j.doe:Passw0rd@dc01.corp.local`.
    // Both halves are targets and both are explicit, so this runs before
    // the filename rule that would otherwise eat the token for its `/`.
    const impacketDomain = IMPACKET_DOMAIN_RE.exec(tok);
    if (impacketDomain) targets.push(impacketDomain[1]);
    // `@host` ends the target; a domain on the left of `@` is a username.
    const atHost = AT_HOST_RE.exec(tok);
    if (atHost) {
      targets.push(atHost[1]);
      continue;
    }
    if (impacketDomain) continue;

    // UNC path: `//dc01.corp.local/SYSVOL` or `\\dc01\SYSVOL`.
    const unc = UNC_RE.exec(tok);
    if (unc) {
      targets.push(unc[1]);
      continue;
    }

    if (HOSTNAME_RE.test(tok) && !VERSIONISH_RE.test(tok)) {
      // `evil.com.` is the same host as `evil.com`; strip the root dot
      // before the tail/TLD checks so the FQDN form cannot slip through.
      const bare = tok.replace(/\.+$/, "");
      const tail = (bare.split(".").pop() ?? "").toLowerCase();
      if (!(tail.length >= 2 && /^[a-z]+$/.test(tail))) continue;
      // Skip obvious filenames: a directory part or a leading path marker.
      // The impacket and UNC forms were peeled off above, so a `/` here
      // really is a directory separator and not a target delimiter.
      if (tok.includes("/") || tok.includes("\\") || tok.startsWith(".")) continue;
      if (inNetworkContext || NEVER_FILE_EXT_TLDS.has(tail)) targets.push(bare);
    }
  }
  return targets;
}
