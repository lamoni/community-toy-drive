import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TABLES } from "./core.js";

export function createSqliteStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "toydrive.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  for (const table of Object.keys(TABLES)) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  db.exec("CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, data TEXT NOT NULL)");

  const check = (table) => {
    if (!TABLES[table]) throw new Error(`Unknown table ${table}`);
  };

  return {
    async list(table) {
      check(table);
      return db.prepare(`SELECT data FROM ${table}`).all().map((r) => JSON.parse(r.data));
    },
    async get(table, id) {
      check(table);
      const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
      return row ? JSON.parse(row.data) : null;
    },
    async insert(table, record) {
      check(table);
      db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`).run(record.id, JSON.stringify(record));
    },
    async update(table, id, changes) {
      check(table);
      const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
      if (!row) return false;
      const data = { ...JSON.parse(row.data), ...changes };
      db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);
      return true;
    },
    async remove(table, id) {
      check(table);
      return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
    },
    async listSummaries() {
      return db.prepare("SELECT data FROM summaries").all().map((r) => JSON.parse(r.data));
    },
    async putSummary(record) {
      db.prepare(
        "INSERT INTO summaries (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"
      ).run(record.id, JSON.stringify(record));
    },
    async clearLists() {
      const nominations = Number(db.prepare("SELECT COUNT(*) AS n FROM nominations").get().n);
      const signups = Number(db.prepare("SELECT COUNT(*) AS n FROM signups").get().n);
      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM nominations");
        db.exec("DELETE FROM signups");
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { nominations, signups };
    },
  };
}
