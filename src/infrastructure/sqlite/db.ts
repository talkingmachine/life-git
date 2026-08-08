import { readFileSync } from "node:fs";

import Database from "better-sqlite3";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function openEvidenceDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.exec(schema);
  return database;
}
