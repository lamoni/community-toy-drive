import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
  if (!Array.isArray(config.towns) || !config.towns.length) {
    throw new Error("site.config.json: \"towns\" must be a non-empty array");
  }
  return config;
}
