/**
 * Data module: subdomain wordlist and port/service definitions for recon.ts.
 * Extracted to reduce recon.ts from ~550 lines to ~340.
 */

export const COMMON_SUBDOMAINS = [
  "www", "mail", "smtp", "pop", "imap", "webmail", "ns1", "ns2",
  "cpanel", "whm", "autodiscover", "autoconfig", "m", "mobile",
  "test", "dev", "staging", "qa", "uat", "prod", "api", "api2",
  "app", "app2", "admin", "panel", "dashboard", "portal", "vpn",
  "cdn", "media", "static", "assets", "img", "images", "files",
  "beta", "old", "new", "shop", "store", "git", "gitlab",
  "cloud", "remote", "secure", "mx", "mail2", "support", "help",
  "status", "docs", "wiki", "blog", "forum", "auth", "login", "sso",
  "dev1", "dev2", "stage", "sandbox", "preview", "demo",
];

export interface PortSpec {
  port: number;
  service: string;
  dangerous?: {
    severity: "critical" | "high" | "medium";
    description: string;
    solution: string;
    cweId: string;
    cvssScore: number;
    wstgId?: string;
  };
}

export const TOP_PORTS: PortSpec[] = [
  { port: 21,  service: "FTP" },
  { port: 22,  service: "SSH" },
  {
    port: 23, service: "Telnet",
    dangerous: {
      severity: "critical",
      description: "Telnet transmits all data — including usernames, passwords, and commands — in plaintext. Any observer on the network path can capture credentials in real time.",
      solution: "Disable Telnet immediately and replace with SSH. Block port 23 at your firewall: `systemctl disable telnet && systemctl stop telnet`.",
      cweId: "CWE-319", cvssScore: 9.8, wstgId: "WSTG-CONF-06",
    },
  },
  { port: 25,  service: "SMTP" },
  { port: 53,  service: "DNS" },
  { port: 80,  service: "HTTP" },
  { port: 110, service: "POP3" },
  { port: 143, service: "IMAP" },
  { port: 443, service: "HTTPS" },
  {
    port: 445, service: "SMB",
    dangerous: {
      severity: "critical",
      description: "SMB (Windows file sharing) is exposed to the public internet. SMB was the vector for the WannaCry and NotPetya ransomware outbreaks via the EternalBlue exploit. Publicly exposed SMB is one of the highest-risk configurations possible.",
      solution: "Block port 445 at your firewall immediately — SMB must never be exposed to the public internet. Use a VPN for any remote file-sharing access.",
      cweId: "CWE-284", cvssScore: 10.0, wstgId: "WSTG-CONF-06",
    },
  },
  { port: 465, service: "SMTPS" },
  { port: 587, service: "SMTP Submission" },
  { port: 993, service: "IMAPS" },
  { port: 995, service: "POP3S" },
  {
    port: 1433, service: "MSSQL",
    dangerous: {
      severity: "high",
      description: "Microsoft SQL Server is exposed to the public internet. Attackers routinely brute-force MSSQL credentials and exploit SQL injection remotely against publicly accessible instances.",
      solution: "Block port 1433 at your firewall. Databases must only be accessible from the application tier on a private network. Use a jump host or VPN for DBA access.",
      cweId: "CWE-284", cvssScore: 8.1,
    },
  },
  {
    port: 1521, service: "Oracle DB",
    dangerous: {
      severity: "high",
      description: "Oracle Database listener is exposed to the public internet. Public exposure allows remote brute-force attacks and exploitation of Oracle-specific vulnerabilities.",
      solution: "Block port 1521 at your firewall. Restrict Oracle listener access to the application subnet only.",
      cweId: "CWE-284", cvssScore: 8.1,
    },
  },
  {
    port: 2375, service: "Docker API (unencrypted)",
    dangerous: {
      severity: "critical",
      description: "The Docker daemon REST API is exposed without TLS on port 2375. An attacker can create privileged containers, mount the host filesystem, escape to the host OS, and achieve full system compromise — no credentials required.",
      solution: "Stop Docker and remove the `-H tcp://0.0.0.0:2375` flag immediately. Use Unix socket + mutual TLS on port 2376 only if remote access is needed, and restrict to known IPs with firewall rules.",
      cweId: "CWE-284", cvssScore: 10.0,
    },
  },
  {
    port: 2376, service: "Docker API (TLS)",
    dangerous: {
      severity: "medium",
      description: "The Docker daemon TLS API is exposed on port 2376. If mutual TLS (client certificate authentication) is not properly configured, this may allow unauthenticated container management.",
      solution: "Ensure mTLS is configured with client certificate validation. Restrict access to known management IPs with firewall rules.",
      cweId: "CWE-284", cvssScore: 5.9,
    },
  },
  { port: 3000, service: "Dev Server / Node.js" },
  {
    port: 3306, service: "MySQL",
    dangerous: {
      severity: "high",
      description: "MySQL database server is exposed to the public internet. This allows remote credential brute-forcing and direct exploitation of database vulnerabilities.",
      solution: "Block port 3306 at your firewall. Bind MySQL to 127.0.0.1 in mysqld.cnf (`bind-address = 127.0.0.1`). Use SSH tunnels for remote DBA access.",
      cweId: "CWE-284", cvssScore: 8.1,
    },
  },
  {
    port: 3389, service: "RDP",
    dangerous: {
      severity: "high",
      description: "Remote Desktop Protocol (RDP) is exposed to the internet. RDP is one of the most commonly attacked services — ransomware groups actively scan for and brute-force exposed RDP endpoints.",
      solution: "Block port 3389 from public internet access. Use a VPN or Bastion/Jump host for remote access. If RDP must be exposed, enable Network Level Authentication and implement account lockout policies.",
      cweId: "CWE-284", cvssScore: 8.1, wstgId: "WSTG-ATHN-03",
    },
  },
  { port: 4443, service: "Alt HTTPS" },
  {
    port: 5432, service: "PostgreSQL",
    dangerous: {
      severity: "high",
      description: "PostgreSQL database server is exposed to the public internet. Public exposure allows remote credential attacks and exploitation of database-level vulnerabilities.",
      solution: "Block port 5432 at your firewall. Set `listen_addresses = 'localhost'` in postgresql.conf. PostgreSQL should only be reachable from the application tier on a private network.",
      cweId: "CWE-284", cvssScore: 8.1,
    },
  },
  {
    port: 5984, service: "CouchDB",
    dangerous: {
      severity: "high",
      description: "CouchDB HTTP API is exposed to the public internet. Older CouchDB versions allow unauthenticated admin access (CVE-2017-12635). Even current versions expose all database contents without a firewall.",
      solution: "Block port 5984 from the public internet. Set `bind_address = 127.0.0.1` in the CouchDB config and use an authenticated reverse proxy for any external access.",
      cweId: "CWE-284", cvssScore: 7.5,
    },
  },
  {
    port: 6379, service: "Redis",
    dangerous: {
      severity: "critical",
      description: "Redis is exposed to the public internet. Redis has no authentication by default — an attacker can read and overwrite all cached data, execute Lua scripts, and in some configurations write cron jobs or SSH authorized_keys to achieve remote code execution.",
      solution: "Block port 6379 at your firewall immediately. Bind Redis to 127.0.0.1 in redis.conf (`bind 127.0.0.1`). Set a strong password with `requirepass`. Redis must never be internet-facing.",
      cweId: "CWE-284", cvssScore: 10.0,
    },
  },
  { port: 8000, service: "Alt HTTP" },
  { port: 8080, service: "Alt HTTP / Proxy" },
  { port: 8443, service: "Alt HTTPS" },
  { port: 8888, service: "Jupyter / Dev Server" },
  { port: 9000, service: "SonarQube / PHP-FPM" },
  {
    port: 9200, service: "Elasticsearch",
    dangerous: {
      severity: "critical",
      description: "Elasticsearch HTTP API is exposed to the public internet. By default Elasticsearch has no authentication — an unauthenticated attacker can read, modify, or delete all indexed data and administer the cluster. Thousands of exposed Elasticsearch instances have been wiped and ransomed.",
      solution: "Block port 9200 with your firewall. Enable X-Pack security (`xpack.security.enabled: true`) and require authentication. Place Elasticsearch behind a private network.",
      cweId: "CWE-284", cvssScore: 9.8,
    },
  },
  {
    port: 11211, service: "Memcached",
    dangerous: {
      severity: "high",
      description: "Memcached is exposed to the public internet. Memcached has no authentication — an attacker can read or poison all cached data. Exposed Memcached servers have been abused in record-breaking DDoS amplification attacks (amplification factor up to 51,000x).",
      solution: "Block port 11211 at your firewall. Bind Memcached to 127.0.0.1 (`-l 127.0.0.1`). Memcached must never be internet-facing.",
      cweId: "CWE-284", cvssScore: 8.1,
    },
  },
  {
    port: 27017, service: "MongoDB",
    dangerous: {
      severity: "critical",
      description: "MongoDB is exposed to the public internet. MongoDB has no authentication by default — an attacker can read, modify, and delete all databases with no credentials. Exposed MongoDB instances have caused numerous large-scale data breaches and ransom attacks.",
      solution: "Block port 27017 at your firewall immediately. Enable MongoDB authentication (`security.authorization: enabled` in mongod.conf). Bind to 127.0.0.1 only.",
      cweId: "CWE-284", cvssScore: 10.0,
    },
  },
];
