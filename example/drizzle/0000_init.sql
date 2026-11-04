CREATE TABLE `moderation_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX `moderation_cases_guild_idx` ON `moderation_cases` (`guild_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `moderation_cases_user_idx` ON `moderation_cases` (`guild_id`,`user_id`);