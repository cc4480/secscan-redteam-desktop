// Is a table that answered an anonymous read a problem, or is it published on purpose?
//
// "The anon key read rows" is an observed fact. Whether it is a flaw depends on what the rows are: a table of
// announcements, a changelog or a product list is meant to be read by every visitor, and filing it as CRITICAL
// ("Client-Side Key Grants Unrestricted Backend Access") trains people to ignore the finding that matters. Three answers,
// because "I cannot tell" is not the same as "sensitive":
//
//   sensitive    — the name or the sampled rows say personal, secret or per-user data
//   public       — the name says published content
//   unclassified — nothing in the name or the rows says either way
//
// Callers report sensitive at full severity and the other two as information, worded as a question for the owner.

export type ExposureClass = "sensitive" | "public" | "unclassified";

const SENSITIVE_TOKENS = new Set([
  "user", "users", "profile", "profiles", "account", "accounts", "order", "orders", "payment", "payments",
  "email", "emails", "token", "tokens", "message", "messages", "secret", "secrets", "customer", "customers",
  "member", "members", "invoice", "invoices", "subscriber", "subscribers", "session", "sessions",
  "credential", "credentials", "contact", "contacts", "address", "addresses", "chat", "chats", "booking",
  "bookings", "transaction", "transactions", "password", "passwords", "admin", "admins", "key", "keys",
  "lead", "leads", "patient", "patients", "student", "students", "employee", "employees", "device", "devices",
  "wallet", "wallets", "card", "cards", "auth", "invite", "invites", "ticket", "tickets", "submission",
  "submissions", "log", "logs", "audit", "private",
]);

const PUBLIC_TOKENS = new Set([
  "product", "products", "post", "posts", "category", "categories", "article", "articles", "faq", "faqs",
  "pricing", "price", "prices", "plan", "plans", "event", "events", "blog", "blogs", "page", "pages", "tag",
  "tags", "testimonial", "testimonials", "review", "reviews", "feature", "features", "service", "services",
  "team", "news", "menu", "menus", "gallery", "banner", "banners", "collection", "collections", "content",
  "item", "items", "course", "courses", "recipe", "recipes", "announcement", "announcements", "notice",
  "notices", "changelog", "changelogs", "release", "releases",
]);

/** Column names (or nested field names) that make a row personal or secret. */
const SENSITIVE_FIELD =
  /(^|[_-])(e-?mail|phone|mobile|password|passwd|pwd|token|secret|ssn|dob|birth\w*|address|api_?key|private_?key|access_?key|refresh_?token|salary|iban|card_?number|cvv)($|[_-])|email|apikey|password|secret|token/i;

/**
 * Columns that say whose a row is: the foreign key a row-level-security policy compares with auth.uid(). A table whose
 * rows carry one holds per-user data. An author is deliberately not an owner: a public post has one.
 */
const OWNER_COLUMN =
  /^(?:user|owner|customer|member|account|tenant|org|organi[sz]ation|workspace|device|session|client|sender|recipient|assignee|uploader)[_-]?(?:id|uuid)$|^(?:uid|userid|ownerid)$|^(?:created|owned|uploaded)[_-]by$/i;

const EMAIL_VALUE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;
const SECRET_VALUE = /^(sk_(live|test)_|sb_secret_|AKIA[0-9A-Z]{16}|ghp_|eyJ[\w-]{20,}\.)/;

function tokens(name: string): string[] {
  return name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function rowsLookSensitive(rows: unknown[]): boolean {
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 4 || node === null) return false;
    if (typeof node === "string") return EMAIL_VALUE.test(node) || SECRET_VALUE.test(node);
    if (Array.isArray(node)) return node.slice(0, 5).some((n) => visit(n, depth + 1));
    if (typeof node === "object") {
      return Object.entries(node as Record<string, unknown>).some(([k, v]) => SENSITIVE_FIELD.test(k) || visit(v, depth + 1));
    }
    return false;
  };
  return rows.slice(0, 5).some((r) => visit(r, 0));
}

function rowsAreOwned(rows: unknown[]): boolean {
  return rows.slice(0, 5).some(
    (r) => r !== null && typeof r === "object" && !Array.isArray(r) && Object.keys(r as Record<string, unknown>).some((k) => OWNER_COLUMN.test(k)),
  );
}

export function classifyExposure(table: string, rows: unknown[]): ExposureClass {
  const t = tokens(table);
  if (t.some((x) => SENSITIVE_TOKENS.has(x)) || rowsLookSensitive(rows)) return "sensitive";
  if (t.length > 0 && t.every((x) => PUBLIC_TOKENS.has(x))) return "public";
  if (rowsAreOwned(rows)) return "sensitive";
  return "unclassified";
}

/** Top-level column names of the first returned row, for evidence lines. */
export function rowColumns(rows: unknown[]): string {
  const first = rows[0];
  return first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first as Record<string, unknown>).slice(0, 12).join(", ") : "";
}
