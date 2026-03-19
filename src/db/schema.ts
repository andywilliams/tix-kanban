import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  model: text('model').notNull(),
  configJson: text('config_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  personaId: text('persona_id').references(() => personas.id).unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  tokenCount: integer('token_count').default(0),
  compactionCount: integer('compaction_count').default(0),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  tokenCount: integer('token_count'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  metadataJson: text('metadata_json'),
});

export const compactions = sqliteTable('compactions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id),
  summary: text('summary').notNull(),
  messagesCompacted: integer('messages_compacted').notNull(),
  tokensFreed: integer('tokens_freed').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const workerRuns = sqliteTable('worker_runs', {
  id: text('id').primaryKey(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  ticketsProcessed: integer('tickets_processed').default(0),
  actionsJson: text('actions_json'),
  status: text('status').notNull().default('running'),
});

export const budgetUsage = sqliteTable('budget_usage', {
  id: text('id').primaryKey(),
  personaId: text('persona_id').references(() => personas.id),
  tokensUsed: integer('tokens_used').notNull(),
  costUsd: real('cost_usd'),
  runId: text('run_id'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
