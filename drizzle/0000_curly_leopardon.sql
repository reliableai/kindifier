CREATE TABLE `connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`ciphertext` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`user_id` text NOT NULL,
	`account` text NOT NULL,
	`id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `account`, `id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rewrites` (
	`user_id` text NOT NULL,
	`account` text NOT NULL,
	`message_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `account`, `message_id`)
);
--> statement-breakpoint
CREATE TABLE `sends` (
	`user_id` text NOT NULL,
	`account` text NOT NULL,
	`id` text NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`gmail_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `account`, `id`)
);
