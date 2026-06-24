PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` integer NOT NULL,
	`fire_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rem_kind_ck" CHECK("__new_reminders"."kind" in ('flight_checkin','document_expiry','custom')),
	CONSTRAINT "rem_ref_ck" CHECK("__new_reminders"."ref_type" in ('segment','document','trip')),
	CONSTRAINT "rem_stat_ck" CHECK("__new_reminders"."status" in ('pending','sending','sent'))
);
--> statement-breakpoint
INSERT INTO `__new_reminders`("id", "user_id", "kind", "ref_type", "ref_id", "fire_at", "status", "attempts", "sent_at", "created_at") SELECT "id", "user_id", "kind", "ref_type", "ref_id", "fire_at", "status", "attempts", "sent_at", "created_at" FROM `reminders`;--> statement-breakpoint
DROP TABLE `reminders`;--> statement-breakpoint
ALTER TABLE `__new_reminders` RENAME TO `reminders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rem_due_idx` ON `reminders` (`status`,`fire_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rem_source_uq` ON `reminders` (`kind`,`ref_type`,`ref_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_ip` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `trips` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `email_notifications` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `webhook_notifications` integer DEFAULT true NOT NULL;