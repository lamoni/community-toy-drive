import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, loadConfig } from "./config.js";

const PRIVATE_DIR = path.join(ROOT, "private");
const MAX_BODY_BYTES = 64 * 1024;
const ADMIN_REQUEST_HEADER = "toydrive-admin";

const ROLES = ["donate-toys", "sponsor-family", "wrap", "deliver"];
export const AGE_GROUPS = [
  { label: "Babies & toddlers (0-2)", min: 0, max: 2 },
  { label: "Preschool (3-5)", min: 3, max: 5 },
  { label: "Kids (6-8)", min: 6, max: 8 },
  { label: "Tweens (9-12)", min: 9, max: 12 },
  { label: "Teens (13-17)", min: 13, max: 17 },
];

export const GIFT_STATUSES = ["needed", "assigned", "purchased", "wrapped", "delivered"];

const ageGroupOf = (age) => AGE_GROUPS.find((g) => age >= g.min && age <= g.max)?.label || "";

export const TABLES = {
  nominations: { statuses: ["new", "contacted", "approved", "sponsored", "delivered", "declined"] },
  signups: { statuses: ["new", "contacted", "confirmed", "inactive"] },
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation helpers ----------

// Control characters plus invisible format characters (zero-width spaces, bidi overrides)
// that can hide or reorder text. Keeps tabs, newlines, and the zero-width joiner used in emoji.
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function str(value, max = 200) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r\n?/g, "\n").replace(INVISIBLE_CHARS, "").trim().slice(0, max);
}

function required(value, label, max) {
  const v = str(value, max);
  if (!v) throw new HttpError(400, `${label} is required.`);
  return v;
}

function email(value, label, isRequired = false) {
  const v = str(value, 200);
  if (!v) {
    if (isRequired) throw new HttpError(400, `${label} is required.`);
    return "";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, `${label} doesn't look like a valid email.`);
  return v;
}

function phone(value, label, isRequired = false) {
  const v = str(value, 40);
  if (!v) {
    if (isRequired) throw new HttpError(400, `${label} is required.`);
    return "";
  }
  const [, number, extension] = v.match(/^(.*?)(?:\s*(?:ext\.?|x|#)\s*(\d{1,6}))?$/i);
  const digits = number.replace(/\D/g, "").length;
  if (!/^\+?[\d\s().-]+$/.test(number) || digits < 10 || digits > 15) {
    throw new HttpError(400, `${label} should be a phone number with area code, like (555) 123-4567.`);
  }
  return extension ? `${number} ext ${extension}` : number;
}

function oneOf(value, allowed, label) {
  const v = str(value, 100);
  if (!allowed.includes(v)) throw new HttpError(400, `Please choose a valid ${label}.`);
  return v;
}

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
}

// ---------- submissions ----------

function parseNomination(body, towns) {
  const submittedBy = oneOf(body.submitted_by, ["self", "other"], "option for who is submitting");
  const n = {
    submitted_by: submittedBy,
    nominator_name: "",
    nominator_phone: "",
    nominator_email: "",
    relationship: "",
    guardian_name: required(body.guardian_name, "Parent/guardian name", 120),
    guardian_phone: phone(body.guardian_phone, "Parent/guardian phone", true),
    guardian_email: email(body.guardian_email, "Parent/guardian email"),
    address: required(body.address, "Full home address", 300),
    town: "",
    notes: str(body.notes, 2000),
  };

  if (submittedBy === "other") {
    n.nominator_name = required(body.nominator_name, "Your name", 120);
    n.nominator_phone = phone(body.nominator_phone, "Your phone");
    n.nominator_email = email(body.nominator_email, "Your email");
    if (!n.nominator_phone && !n.nominator_email) throw new HttpError(400, "Please give us a phone number or email for you.");
    n.relationship = str(body.relationship, 120);
  }

  if (!Array.isArray(body.children) || body.children.length === 0) {
    throw new HttpError(400, "Please add at least one child.");
  }
  if (body.children.length > 15) throw new HttpError(400, "Please contact us directly for more than 15 children.");
  n.children = body.children.map((c, i) => {
    const label = `Child ${i + 1}`;
    const age = Number(c.age);
    if (c.age === "" || !Number.isInteger(age) || age < 0 || age > 17) {
      throw new HttpError(400, `${label}: age must be between 0 and 17.`);
    }
    return {
      first_name: required(c.first_name, `${label} first name`, 60),
      age,
      gender: (() => {
        const g = str(c.gender, 10);
        if (g !== "Boy" && g !== "Girl") throw new HttpError(400, `${label}: please choose boy or girl.`);
        return g;
      })(),
      clothing_size: str(c.clothing_size, 40),
      shoe_size: str(c.shoe_size, 20),
      wishes: str(c.wishes, 500),
      gift_status: "needed",
      gift_notes: "",
    };
  });

  if (body.consent !== true) throw new HttpError(400, "Please confirm the family has agreed to be contacted.");
  return n;
}

function parseSignup(body, towns) {
  const roles = Array.isArray(body.roles) ? body.roles.filter((r) => ROLES.includes(r)) : [];
  if (!roles.length) throw new HttpError(400, "Please choose at least one way you'd like to help.");
  const s = {
    name: required(body.name, "Name", 120),
    email: email(body.email, "Email"),
    phone: phone(body.phone, "Phone"),
    town: body.town ? oneOf(body.town, towns, "town") : "",
    organization: str(body.organization, 120),
    roles,
    families_to_sponsor: 0,
    notes: str(body.notes, 2000),
  };
  if (!s.email && !s.phone) throw new HttpError(400, "Please give us an email or phone number.");
  if (roles.includes("sponsor-family")) {
    const count = Number(body.families_to_sponsor || 1);
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new HttpError(400, "Number of families must be 1-50.");
    s.families_to_sponsor = count;
  }
  return s;
}

// ---------- csv ----------

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // prevent spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

// Counts only. Callers must not add names, contact details, addresses, towns,
// sizes, wish lists, or notes — those can identify a child in a small community.
export function buildAnonymousSummary({ nominations, signups, year, savedAt }) {
  const byStatus = Object.fromEntries(TABLES.nominations.statuses.map((s) => [s, 0]));
  const submittedBy = { self: 0, other: 0 };
  const gifts = Object.fromEntries(GIFT_STATUSES.map((s) => [s, 0]));
  const ageGroups = AGE_GROUPS.map((g) => ({
    label: g.label,
    min: g.min,
    max: g.max,
    boys: 0,
    girls: 0,
    unspecified: 0,
    boys_still_need: 0,
    girls_still_need: 0,
    unspecified_still_need: 0,
  }));

  let families = 0;
  let children = 0;
  for (const row of nominations) {
    if (Object.hasOwn(byStatus, row.status)) byStatus[row.status] += 1;
    if (row.status === "declined") continue;
    families += 1;
    if (Object.hasOwn(submittedBy, row.submitted_by)) submittedBy[row.submitted_by] += 1;
    for (const kid of row.children || []) {
      children += 1;
      const gift = GIFT_STATUSES.includes(kid.gift_status) ? kid.gift_status : "needed";
      gifts[gift] += 1;
      const group = ageGroups.find((g) => kid.age >= g.min && kid.age <= g.max);
      if (!group) continue;
      const key = kid.gender === "Boy" ? "boys" : kid.gender === "Girl" ? "girls" : "unspecified";
      group[key] += 1;
      if (gift === "needed") group[`${key}_still_need`] += 1;
    }
  }

  const signupStatus = Object.fromEntries(TABLES.signups.statuses.map((s) => [s, 0]));
  const byRole = Object.fromEntries(ROLES.map((r) => [r, 0]));
  let active = 0;
  let familiesPledged = 0;
  for (const row of signups) {
    if (Object.hasOwn(signupStatus, row.status)) signupStatus[row.status] += 1;
    if (row.status === "inactive") continue;
    active += 1;
    for (const role of row.roles || []) {
      if (!Object.hasOwn(byRole, role)) byRole[role] = 0;
      byRole[role] += 1;
    }
    const pledged = Number(row.families_to_sponsor);
    if ((row.roles || []).includes("sponsor-family") && Number.isInteger(pledged) && pledged > 0) {
      familiesPledged += pledged;
    }
  }

  return {
    id: String(year),
    year: String(year),
    saved_at: savedAt,
    nominations: {
      submissions: nominations.length,
      families,
      children,
      by_status: byStatus,
      submitted_by: submittedBy,
      children_by_gift: gifts,
      age_groups: ageGroups,
    },
    signups: {
      submissions: signups.length,
      active,
      families_pledged: familiesPledged,
      by_status: signupStatus,
      by_role: byRole,
    },
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stableJson(value[k])]));
  }
  return value;
}

// Ignores saved_at so a stored summary can be compared with a fresh count.
export function summaryFingerprint(summary) {
  return JSON.stringify(stableJson({ year: summary.year, nominations: summary.nominations, signups: summary.signups }));
}

function flattenForCsv(table, row) {
  const out = { ...row };
  if (table === "nominations") {
    out.child_count = row.children.length;
    out.ages = row.children.map((k) => k.age).join(", ");
    out.age_groups = [...new Set(row.children.map((k) => ageGroupOf(k.age)))].join("; ");
    out.kids_needing_gift = row.children.filter((k) => (k.gift_status || "needed") === "needed").length;
    out.children = row.children
      .map(
        (k) =>
          `${k.first_name} (${k.age}${k.gender ? ", " + k.gender : ""}) sizes: ${k.clothing_size || "-"}/${k.shoe_size || "-"} wishes: ${k.wishes || "-"} gift: ${k.gift_status || "needed"}${k.gift_notes ? " - " + k.gift_notes : ""}`
      )
      .join(" | ");
  } else {
    out.roles = row.roles.join("; ");
  }
  return out;
}

// ---------- app ----------

/**
 * Creates a platform-independent request handler.
 * request:  { method, path, headers (lower-cased keys), body (string), ip }
 * response: { status, headers, body (string) }
 */
export function createApp({ store, adminPassword = "", rateLimitPerIp = 10 }) {
  const config = loadConfig();
  const towns = [...config.towns, "Other"];
  const hits = new Map();

  const json = (status, body) => ({
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  });

  function parseBody(raw) {
    if (Buffer.byteLength(raw || "", "utf8") > MAX_BODY_BYTES) throw new HttpError(413, "Submission is too large.");
    try {
      const body = JSON.parse(raw || "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body;
    } catch {
      throw new HttpError(400, "Invalid request.");
    }
  }

  // Best-effort per-instance limit; the hosting layer should also throttle.
  function rateLimit(ip) {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (recent.length >= rateLimitPerIp) throw new HttpError(429, "Too many submissions. Please try again later.");
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 10000) hits.clear();
  }

  function checkHoneypot(body) {
    // Bots fill every field; real users never see this one.
    if (str(body.website)) throw new HttpError(400, "Submission rejected.");
  }

  function isAdmin(headers) {
    if (!adminPassword) return false;
    const header = headers.authorization || "";
    if (!header.startsWith("Basic ")) return false;
    const [user, ...rest] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
    const given = crypto.createHash("sha256").update(rest.join(":")).digest();
    const expected = crypto.createHash("sha256").update(adminPassword).digest();
    return crypto.timingSafeEqual(given, expected) && user === "admin";
  }

  function privateFile(name, type) {
    return {
      status: 200,
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
      body: fs.readFileSync(path.join(PRIVATE_DIR, name), "utf8"),
    };
  }

  async function handleAdmin(req) {
    if (!adminPassword) {
      return {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Admin is disabled. Set the ADMIN_PASSWORD environment variable to enable it.",
      };
    }
    if (!isAdmin(req.headers)) {
      return {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Toy Drive Admin", charset="UTF-8"', "Content-Type": "text/plain" },
        body: "Authentication required.",
      };
    }

    // Browsers resend Basic auth on cross-site requests. A custom header forces a CORS
    // preflight, which this API never approves, so other sites can't make admin changes.
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== ADMIN_REQUEST_HEADER) {
      throw new HttpError(403, "Forbidden");
    }

    if (req.path === "/admin" || req.path === "/admin/") {
      const res = privateFile("admin.html", "text/html; charset=utf-8");
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      res.body = res.body
        .replaceAll("{{siteName}}", esc(config.shortName || config.siteName))
        .replaceAll("{{orgName}}", esc(config.organization.name));
      return res;
    }
    if (req.path === "/admin/admin.js") return privateFile("admin.js", "text/javascript; charset=utf-8");

    if (req.path === "/api/admin/summaries" || req.path === "/api/admin/summaries/clear-lists") {
      return handleSummaries(req);
    }

    const childMatch = req.path.match(/^\/api\/admin\/nominations\/([a-z0-9]{1,40})\/children\/(\d{1,2})$/);
    if (childMatch) {
      if (req.method !== "PATCH") throw new HttpError(405, "Method not allowed");
      const [, id, index] = childMatch;
      const body = parseBody(req.body);
      const changes = {};
      if (body.gift_status !== undefined) changes.gift_status = oneOf(body.gift_status, GIFT_STATUSES, "gift status");
      if (body.gift_notes !== undefined) changes.gift_notes = str(body.gift_notes, 300);
      if (!Object.keys(changes).length) throw new HttpError(400, "Nothing to update.");
      const row = await store.get("nominations", id);
      const child = row?.children?.[Number(index)];
      if (!child) throw new HttpError(404, "Not found");
      const children = row.children.map((k, i) => (i === Number(index) ? { ...k, ...changes } : k));
      if (!(await store.update("nominations", id, { children }))) throw new HttpError(404, "Not found");
      return json(200, { ok: true });
    }

    const match = req.path.match(/^\/api\/admin\/(nominations|signups)(?:\.(csv)|\/([a-z0-9]{1,40}))?$/);
    if (!match) throw new HttpError(404, "Not found");
    const [, table, csv, id] = match;

    if (req.method === "GET" && !id) {
      const rows = (await store.list(table)).sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (csv) {
        return {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
            "Cache-Control": "no-store",
          },
          body: toCsv(rows.map((r) => flattenForCsv(table, r))),
        };
      }
      return json(200, { statuses: TABLES[table].statuses, ageGroups: AGE_GROUPS, giftStatuses: GIFT_STATUSES, rows });
    }

    if (req.method === "PATCH" && id) {
      const body = parseBody(req.body);
      const changes = {};
      if (body.status !== undefined) changes.status = oneOf(body.status, TABLES[table].statuses, "status");
      if (body.admin_notes !== undefined) changes.admin_notes = str(body.admin_notes, 2000);
      if (!Object.keys(changes).length) throw new HttpError(400, "Nothing to update.");
      if (!(await store.update(table, id, changes))) throw new HttpError(404, "Not found");
      return json(200, { ok: true });
    }

    if (req.method === "DELETE" && id) {
      if (!(await store.remove(table, id))) throw new HttpError(404, "Not found");
      return json(200, { ok: true });
    }

    throw new HttpError(405, "Method not allowed");
  }

  function seasonYear() {
    const year = String(config.year || "").trim();
    if (!/^\d{4}$/.test(year)) {
      throw new HttpError(500, "Set a four-digit year in site.config.json before using season summaries.");
    }
    return year;
  }

  async function summaryState() {
    const year = seasonYear();
    const [nominations, signups, summaries] = await Promise.all([
      store.list("nominations"),
      store.list("signups"),
      store.listSummaries(),
    ]);
    const saved = summaries.find((s) => s.id === year) || null;
    const fresh = buildAnonymousSummary({ nominations, signups, year, savedAt: "" });
    summaries.sort((a, b) => String(b.year).localeCompare(String(a.year)));
    return {
      year,
      nominations,
      signups,
      saved,
      fresh,
      inSync: Boolean(saved) && summaryFingerprint(fresh) === summaryFingerprint(saved),
      summaries,
    };
  }

  async function handleSummaries(req) {
    if (req.path === "/api/admin/summaries" && req.method === "GET") {
      const { year, nominations, signups, inSync, summaries } = await summaryState();
      return json(200, {
        year,
        current: { nominations: nominations.length, signups: signups.length, summary_in_sync: inSync },
        summaries,
      });
    }

    if (req.path === "/api/admin/summaries" && req.method === "POST") {
      const { year, nominations, signups } = await summaryState();
      if (!nominations.length && !signups.length) {
        throw new HttpError(400, "There are no submissions to summarize. The saved summary was left as it is.");
      }
      const summary = buildAnonymousSummary({
        nominations,
        signups,
        year,
        savedAt: new Date().toISOString(),
      });
      await store.putSummary(summary);
      return json(200, summary);
    }

    if (req.path === "/api/admin/summaries/clear-lists" && req.method === "POST") {
      const { year, nominations, signups, saved, inSync } = await summaryState();
      if (!nominations.length && !signups.length) {
        throw new HttpError(400, "The lists are already empty. The saved summary was left as it is.");
      }
      if (!saved) throw new HttpError(400, `Save the anonymous summary for ${year} before deleting the lists.`);
      if (!inSync) {
        throw new HttpError(409, "The lists have changed since the summary was saved. Save the summary again, then delete them.");
      }
      const deleted = await store.clearLists();
      return json(200, { ok: true, deleted });
    }

    throw new HttpError(405, "Method not allowed");
  }

  async function submitTo(table, parse, req) {
    rateLimit(req.ip || "unknown");
    const body = parseBody(req.body);
    checkHoneypot(body);
    const record = {
      id: newId(),
      created_at: new Date().toISOString(),
      status: "new",
      admin_notes: "",
      ...parse(body, towns),
    };
    await store.insert(table, record);
    return json(201, { ok: true });
  }

  return async function handle(req) {
    try {
      if (req.path === "/admin" || req.path.startsWith("/admin/") || req.path.startsWith("/api/admin/")) {
        return await handleAdmin(req);
      }
      if (req.method === "POST" && req.path === "/api/nominations") return await submitTo("nominations", parseNomination, req);
      if (req.method === "POST" && req.path === "/api/signups") return await submitTo("signups", parseSignup, req);
      throw new HttpError(404, "Not found");
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json(status, { error: status === 500 ? "Something went wrong. Please try again." : err.message });
    }
  };
}
