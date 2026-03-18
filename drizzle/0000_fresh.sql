-- Drizzle migration: create tables
-- Generated manually to replace raw SQL in migrate.ts

CREATE TABLE IF NOT EXISTS `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`config_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text REFERENCES `personas`(`id`),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`token_count` integer DEFAULT 0,
	`compaction_count` integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text REFERENCES `sessions`(`id`),
	`role` text NOT NULL,
	`content` text NOT NULL,
	`token_count` integer,
	`created_at` integer NOT NULL,
	`metadata_json` text
);

CREATE TABLE IF NOT EXISTS `compactions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text REFERENCES `sessions`(`id`),
	`summary` text NOT NULL,
	`messages_compacted` integer NOT NULL,
	`tokens_freed` integer NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `worker_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`tickets_processed` integer DEFAULT 0,
	`actions_json` text,
	`status` text NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS `budget_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`persona_id` text REFERENCES `personas`(`id`),
	`tokens_used` integer NOT NULL,
	`cost_usd` real,
	`run_id` text,
	`recorded_at` integer NOT NULL
);
