import type { Config } from 'drizzle-kit';
import { join } from 'path';
import { homedir } from 'os';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.FORGE_DB_PATH || join(homedir(), '.forge', 'forge.db'),
  },
} satisfies Config;
