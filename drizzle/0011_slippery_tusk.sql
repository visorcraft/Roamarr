PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_travel_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`number` text,
	`issuing_authority` text,
	`expires_on` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "docs_type_ck" CHECK("__new_travel_documents"."type" in ('passport','drivers_license','global_entry','visa'))
);
--> statement-breakpoint
INSERT INTO `__new_travel_documents`("id", "user_id", "type", "number", "issuing_authority", "expires_on", "notes") SELECT "id", "user_id", "type", "number", "issuing_authority", "expires_on", "notes" FROM `travel_documents`;--> statement-breakpoint
DROP TABLE `travel_documents`;--> statement-breakpoint
ALTER TABLE `__new_travel_documents` RENAME TO `travel_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `docs_user_exp_idx` ON `travel_documents` (`user_id`,`expires_on`);