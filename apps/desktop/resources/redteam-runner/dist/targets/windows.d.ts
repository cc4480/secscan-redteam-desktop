/**
 * Windows target profile — host + Active Directory.
 *
 * EXHAUSTIVE battery (v0.8.0): surface × technique. Surfaces: network
 * recon (SMB/NetBIOS/RDP/WinRM/SQL/SNMP/DNS/host web), auth attacks
 * (authorized test accounts ONLY — T1078), Active Directory (trusts,
 * delegation, GPOs, DACLs, AD CS, attack paths), privilege escalation,
 * lateral movement (authorized scope, fully logged), credential-access
 * exposure (audited — nothing exfiltrated beyond evidence), persistence
 * FINDINGS (reported, NEVER planted), EDR/AV awareness, and host
 * hardening posture.
 *
 * Non-destructive always: read-only enumeration preferred; no service
 * crashing; no ransomware-style behavior; persistence mechanisms REPORTED
 * as findings, never planted; hijack proofs use benign canary files only.
 *
 * Execution model (v0.10.0): the runner's host-exec tools execute this
 * battery — `smb_exec` (share reachability + listing), `winrm_exec`
 * (PowerShell/cmd commands), `winrm_probe` (WS-010 listener/auth-scheme
 * probe), `rdp_auth` (WS-019 NLA credential validation), `smb_pth` (WS-023
 * pass-the-hash with NTLMv2), `ad_enum` (WS-038 attack-path computation +
 * WS-043 AD CS template audit, both read-only LDAP), `krb_ptt` (WS-064
 * ticket replay via MIT krb5 tools), and `rdp_shadow_prep` (WS-065 prepares
 * the human handoff — session IDs, exact command, consent checklist).
 * Two items keep honest prerequisites in `needs` (NOT plan-only — they
 * execute when the prerequisite is met): WS-064 needs kerberos ticket
 * material (ccache/kirbi via env, or kinit credentials); WS-065 needs a
 * human operator for the shadowing act itself (preparation is automated).
 * SMB share enumeration note: the library has no NetShareEnum, so
 * list_shares is reachability probing of well-known + recon-supplied names.
 */
import type { TargetProfile } from "./types.js";
export declare const WINDOWS_PROFILE: TargetProfile;
