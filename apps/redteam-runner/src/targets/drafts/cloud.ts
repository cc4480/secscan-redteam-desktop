/**
 * Cloud family (CL-*) â€” cloud control-plane and data-plane flaws.
 *
 * Opt-in like `webapp`: selected with --targets cloud. The surface is the
 * customer's cloud account as seen from the application: storage policies, the
 * instance metadata service, IAM on the workload identity, logging, snapshots
 * and serverless configuration. Read-only checks unless a benign canary write is
 * explicitly authorized, and never against another tenant's resources.
 */
import type { DraftTargetProfile } from "./types.js";

export const CLOUD_PROFILE: DraftTargetProfile = {
  id: "cloud",
  name: "Cloud account (AWS/Azure/GCP)",
  baseUrl: "https://<provider>.cloud",
  kind: "cloud",
  authModel: "Cloud IAM (workload identity / access keys) plus resource policies (bucket, snapshot, function)",
  scopeNotes:
    "One authorized account, read-only metadata enumeration. Never touch another tenant's objects, never change billing or logging unless a benign canary is explicitly approved, never use discovered credentials outside the engagement.",
  battery: [
    {
      id: "CL-001", category: "validation", name: "Public object-storage listing",
      brief: "Bucket/container listable anonymously â€” is the bucket policy allow-public or is block-public-access off?",
      owasp: "A01:2021", attackId: "T1530",
      what: "Query the storage endpoint anonymously: GET /?list-type=2 (S3), both with and without a known object key. A 200/403 split that lists keys anonymously is the finding; a denied 403 is the control working. Record the bucket policy field that allows it (public-read, missing blockPublicAccess).",
    },
    {
      id: "CL-002", category: "validation", name: "IMDS reachable via SSRF",
      brief: "Can an app-side URL fetch reach 169.254.169.254 and return credentials?",
      owasp: "A10:2021", attackId: "T1552.005",
      what: "Through the app's URL-fetch/SSRF entry point, request http://169.254.169.254/latest/meta-data/ and the AWS/GCP/Azure token endpoints (with the metadata headers each requires). Confirm only when credentials or identity documents are returned; a timeout or 403 is a pass. Never use returned credentials beyond a read-only identity check on the same account.",
    },
    {
      id: "CL-003", category: "logic", name: "Over-permissive workload IAM role",
      brief: "Does the app identity hold admin/*:*/Resource:* instead of least privilege?",
      owasp: "A01:2021", attackId: "T1078.004",
      what: "Enumerate the attached policies of the identity the workload runs as (GetCallerIdentity, list-attached-role-policies, or the provider equivalent through the app's own error surface). Report every Action:* / Resource:* grant and whether the workload actually needs it; a wildcard action on a resource it never uses is the finding.",
    },
    {
      id: "CL-004", category: "functionality", name: "Long-lived access keys exposed",
      brief: "Static keys in env vars, user-data, build config, or the repo instead of a role.",
      owasp: "A02:2021", attackId: "T1552.001",
      what: "Inspect the app's own error/health surface and any readable config for AKIA*/AZURE_* static keys. If found, verify read-only whether the key authenticates (sts get-caller-identity style) without using it for anything else, then report it as a credential-hygiene finding with the rotation path.",
    },
    {
      id: "CL-005", category: "logic", name: "Cloud audit logging gap or tamper",
      brief: "Is CloudTrail/Activity/Audit log enabled, multi-region, and immutable?",
      owasp: "A09:2021", attackId: "T1562.008",
      what: "Read the logging configuration: trail/activity-log enabled, multi-region, log-file validation, and whether the workload identity could stop or delete the trail. A workload that can disable its own audit trail is the finding even when the trail is currently on.",
    },
    {
      id: "CL-006", category: "validation", name: "Public snapshot or image share",
      brief: "AMIs/snapshots/disks shared publicly or with an unknown account.",
      owasp: "A01:2021", attackId: "T1530",
      what: "Read the share attributes (describe-image-attribute / snapshot createVolumePermission). Public or cross-account shares to parties outside the engagement are a data-exposure finding; record the exact attribute and the shared object ids.",
    },
    {
      id: "CL-007", category: "functionality", name: "Serverless environment secret exposure",
      brief: "Function env vars / code / layers leak secrets to an unprivileged caller.",
      owasp: "A02:2021", attackId: "T1552.001",
      what: "Check whether an app-side error, debug endpoint or misconfigured function URL exposes environment variables or code. Confirm by reading the secret name (never the full value) and reporting the exposure path plus the fix (secret manager + redaction).",
    },
    {
      id: "CL-008", category: "validation", name: "IMDSv1 enabled / weak hop limit",
      brief: "Metadata service reachable with a single request and no session token.",
      owasp: "A10:2021", attackId: "T1552.005",
      what: "Request the metadata service without the token-exchange step (IMDSv1) and check the hop limit / container-network reachability. IMDSv1 reachable from a compromised app process is the finding; IMDSv2-only is the control working. Never fetch more than one metadata path.",
    },
  ],
};


