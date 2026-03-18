import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.FORGE_DB_PATH || join(homedir(), '.forge', 'forge.db');

// Ensure directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    config_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    persona_id TEXT REFERENCES personas(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    token_count INTEGER DEFAULT 0,
    compaction_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    created_at INTEGER NOT NULL,
    metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS compactions (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    summary TEXT NOT NULL,
    messages_compacted INTEGER NOT NULL,
    tokens_freed INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS worker_runs (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    tickets_processed INTEGER DEFAULT 0,
    actions_json TEXT,
    status TEXT NOT NULL DEFAULT 'running'
  );

  CREATE TABLE IF NOT EXISTS budget_usage (
    id TEXT PRIMARY KEY,
    persona_id TEXT REFERENCES personas(id),
    tokens_used INTEGER NOT NULL,
    cost_usd REAL,
    run_id TEXT,
    recorded_at INTEGER NOT NULL
  );
`);

console.log('✅ Database migrated successfully!');
console.log('Database path:', DB_PATH);

// Verify tables
const tables = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' 
  ORDER BY name
`).all();

console.log('Tables created:', tables.map(t => (t as any).name).join(', '));

db.close();
