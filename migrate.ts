import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.FORGE_DB_PATH || join(homedir(), '.forge', 'forge.db');

// Ensure directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);

// Run Drizzle migrations by reading and executing SQL files
// This approach reads SQL files and splits by semicolon for multiple statements
const migrationsFolder = join(__dirname, 'drizzle');
const journalPath = join(migrationsFolder, 'meta', '_journal.json');

interface MigrationEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
}

interface Journal {
  version: string;
  dialect: string;
  entries: MigrationEntry[];
}

// Get applied migrations from database
function getAppliedMigrations(): string[] {
  try {
    const result = sqlite.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name = '__drizzle_migrations'
    `).get();
    
    if (!result) {
      // Create migrations tracking table
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
      `);
      return [];
    }
    
    const rows = sqlite.prepare('SELECT hash FROM __drizzle_migrations').all() as { hash: string }[];
    return rows.map(r => r.hash);
  } catch (err: any) {
    // Only ignore "no such table" errors - re-throw actual database errors
    if (err?.message?.includes('no such table')) {
      return [];
    }
    throw new Error(`Failed to get applied migrations: ${err?.message || err}`);
  }
}

// Apply a migration file
function applyMigration(tag: string, sql: string): void {
  // Split by semicolons and filter empty statements
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  sqlite.exec('BEGIN TRANSACTION');
  try {
    for (const stmt of statements) {
      if (stmt.trim()) {
        sqlite.exec(stmt);
      }
    }
    const insertStmt = sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
insertStmt.run(tag, Date.now());
    sqlite.exec('COMMIT');
    console.log(`Applied migration: ${tag}`);
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

// Read journal and apply pending migrations
let migrationsApplied = 0;
if (existsSync(migrationsFolder) && existsSync(journalPath)) {
  const journal: Journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
  const applied = getAppliedMigrations();
  
  for (const entry of journal.entries) {
    const migrationFile = join(migrationsFolder, `${entry.tag}.sql`);
    if (!applied.includes(entry.tag) && existsSync(migrationFile)) {
      const sql = readFileSync(migrationFile, 'utf-8');
      applyMigration(entry.tag, sql);
      migrationsApplied++;
    }
  }
}

if (migrationsApplied > 0) {
  console.log(`✅ Database migrated successfully! (${migrationsApplied} migration${migrationsApplied > 1 ? 's' : ''} applied)`);
} else if (!existsSync(migrationsFolder) || !existsSync(journalPath)) {
  console.log('⚠️ No migrations folder or journal found - skipping migration');
} else {
  console.log('✅ Database is up to date - no migrations to apply');
}
console.log('Database path:', DB_PATH);

// Verify tables
const tables = sqlite.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name NOT LIKE '__drizzle%'
  ORDER BY name
`).all();

console.log('Tables created:', tables.map(t => (t as any).name).join(', '));

sqlite.close();
