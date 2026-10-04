ALTER TABLE `connections` ADD `connection_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `connections` SET `connection_id` = lower(hex(randomblob(16)));
