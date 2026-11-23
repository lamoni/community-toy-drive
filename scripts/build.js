// Renders templates/*.html with site.config.json into dist/, and copies public/ alongside.
//
// Template syntax:
//   {{path.to.value}}            HTML-escaped value
//   {{{path}}}                   raw value
//   {{> partial}}                include templates/partials/partial.html
//   {{#each list}}...{{/each}}   loop; use {{this}} or {{this.field}} inside
//   {{#if path}}...{{else}}...{{/if}}
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadConfig } from "../src/config.js";

const TEMPLATES = path.join(ROOT, "templates");
const PARTIALS = path.join(TEMPLATES, "partials");
const PUBLIC = path.join(ROOT, "public");
const DIST = path.join(ROOT, "dist");

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function lookup(expr, scopes) {
  for (const scope of scopes) {
    let value = scope;
    let found = true;
    for (const key of expr.split(".")) {
      if (value !== null && typeof value === "object" && key in value) value = value[key];
      else {
        found = false;
        break;
      }
    }
    if (found) return value;
  }
  return undefined;
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

function render(template, scopes) {
  let out = template.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) =>
    fs.readFileSync(path.join(PARTIALS, `${name}.html`), "utf8")
  );

  const block = /\{\{#(each|if) ([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/;
  let m;
  while ((m = out.match(block))) {
    const [whole, kind, expr, inner] = m;
    const value = lookup(expr, scopes);
    let replacement;
    if (kind === "each") {
      replacement = (Array.isArray(value) ? value : []).map((item) => render(inner, [{ this: item }, ...scopes])).join("");
    } else {
      const [yes, no = ""] = inner.split("{{else}}");
      replacement = render(truthy(value) ? yes : no, scopes);
    }
    out = out.slice(0, m.index) + replacement + out.slice(m.index + whole.length);
  }

  return out
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, expr) => String(lookup(expr, scopes) ?? ""))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, expr) => escapeHtml(lookup(expr, scopes)));
}

function joinNames(names) {
  if (names.length <= 1) return names.join("");
  return names.slice(0, -1).join(", ") + " & " + names.at(-1);
}

function buildContext(config) {
  const partners = config.partners || [];
  return {
    ...config,
    partners,
    hasPartners: partners.length > 0,
    partnerNames: joinNames(partners.map((p) => p.name)),
    presentedBy: joinNames([config.organization.name, ...partners.map((p) => p.name)]),
    phoneHref: (config.contact.phone || "").replace(/[^\d+]/g, ""),
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

export function build() {
  const context = buildContext(loadConfig());
  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(PUBLIC, DIST);
  for (const file of fs.readdirSync(TEMPLATES)) {
    if (!file.endsWith(".html")) continue;
    const html = render(fs.readFileSync(path.join(TEMPLATES, file), "utf8"), [context]);
    fs.writeFileSync(path.join(DIST, file), html);
  }
  return DIST;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Built site into ${path.relative(process.cwd(), build()) || "."}`);
}
