import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const DB_PATH = process.env.FORGE_DB_PATH || join(homedir(), '.forge', 'forge.db');

// Ensure directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.exec('PRAGMA foreign_keys = ON');
export const db = drizzle(sqlite, { schema });

export { schema };
export type Database = typeof db;
