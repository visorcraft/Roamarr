PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_benefit_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`benefit_type` text NOT NULL,
	`name` text NOT NULL,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text,
	CONSTRAINT "benefit_template_type_ck" CHECK("__new_benefit_templates"."benefit_type" in ('trip_delay', 'baggage_delay', 'trip_cancellation', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_benefit_templates`("id", "benefit_type", "name", "coverage_amount", "currency", "description") SELECT "id", "benefit_type", "name", "coverage_amount", "currency", "description" FROM `benefit_templates`;--> statement-breakpoint
DROP TABLE `benefit_templates`;--> statement-breakpoint
ALTER TABLE `__new_benefit_templates` RENAME TO `benefit_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_card_benefits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`benefit_type` text NOT NULL,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "benefit_type_ck" CHECK("__new_card_benefits"."benefit_type" in ('trip_delay', 'baggage_delay', 'trip_cancellation', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_card_benefits`("id", "card_id", "benefit_type", "coverage_amount", "currency", "notes") SELECT "id", "card_id", "benefit_type", "coverage_amount", "currency", "notes" FROM `card_benefits`;--> statement-breakpoint
DROP TABLE `card_benefits`;--> statement-breakpoint
ALTER TABLE `__new_card_benefits` RENAME TO `card_benefits`;--> statement-breakpoint
CREATE TABLE `__new_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`nickname` text NOT NULL,
	`network` text NOT NULL,
	`last4` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cards_net_ck" CHECK("__new_cards"."network" in ('visa', 'mc', 'amex', 'disc', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_cards`("id", "user_id", "nickname", "network", "last4", "notes") SELECT "id", "user_id", "nickname", "network", "last4", "notes" FROM `cards`;--> statement-breakpoint
DROP TABLE `cards`;--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;--> statement-breakpoint
CREATE INDEX `cards_user_idx` ON `cards` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_fare_watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`segment_id` integer,
	`provider_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_checked_at` text,
	`last_result_json` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `fare_providers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "watch_status_ck" CHECK("__new_fare_watches"."status" in ('active', 'paused'))
);
--> statement-breakpoint
INSERT INTO `__new_fare_watches`("id", "trip_id", "segment_id", "provider_id", "status", "last_checked_at", "last_result_json", "created_at") SELECT "id", "trip_id", "segment_id", "provider_id", "status", "last_checked_at", "last_result_json", "created_at" FROM `fare_watches`;--> statement-breakpoint
DROP TABLE `fare_watches`;--> statement-breakpoint
ALTER TABLE `__new_fare_watches` RENAME TO `fare_watches`;--> statement-breakpoint
CREATE INDEX `watch_provider_idx` ON `fare_watches` (`provider_id`);--> statement-breakpoint
CREATE INDEX `watch_status_idx` ON `fare_watches` (`status`);--> statement-breakpoint
CREATE INDEX `watch_trip_idx` ON `fare_watches` (`trip_id`);--> statement-breakpoint
CREATE INDEX `watch_segment_idx` ON `fare_watches` (`segment_id`);--> statement-breakpoint
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
	CONSTRAINT "rem_kind_ck" CHECK("__new_reminders"."kind" in ('flight_checkin', 'document_expiry', 'custom')),
	CONSTRAINT "rem_ref_ck" CHECK("__new_reminders"."ref_type" in ('segment', 'document', 'trip')),
	CONSTRAINT "rem_stat_ck" CHECK("__new_reminders"."status" in ('pending', 'sending', 'sent'))
);
--> statement-breakpoint
INSERT INTO `__new_reminders`("id", "user_id", "kind", "ref_type", "ref_id", "fire_at", "status", "attempts", "sent_at", "created_at") SELECT "id", "user_id", "kind", "ref_type", "ref_id", "fire_at", "status", "attempts", "sent_at", "created_at" FROM `reminders`;--> statement-breakpoint
DROP TABLE `reminders`;--> statement-breakpoint
ALTER TABLE `__new_reminders` RENAME TO `reminders`;--> statement-breakpoint
CREATE INDEX `rem_due_idx` ON `reminders` (`status`,`fire_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rem_source_uq` ON `reminders` (`kind`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `__new_segment_attendees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`segment_id` integer NOT NULL,
	`companion_id` integer NOT NULL,
	`status` text DEFAULT 'going' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attendee_status_ck" CHECK("__new_segment_attendees"."status" in ('going', 'maybe', 'not_going'))
);
--> statement-breakpoint
INSERT INTO `__new_segment_attendees`("id", "segment_id", "companion_id", "status", "created_at") SELECT "id", "segment_id", "companion_id", "status", "created_at" FROM `segment_attendees`;--> statement-breakpoint
DROP TABLE `segment_attendees`;--> statement-breakpoint
ALTER TABLE `__new_segment_attendees` RENAME TO `segment_attendees`;--> statement-breakpoint
CREATE INDEX `attendees_segment_idx` ON `segment_attendees` (`segment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendee_segment_companion_uq` ON `segment_attendees` (`segment_id`,`companion_id`);--> statement-breakpoint
CREATE TABLE `__new_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`start_tz` text DEFAULT 'UTC' NOT NULL,
	`end_at` text,
	`end_tz` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`location` text,
	`confirmation_number` text,
	`details_json` text,
	`meeting_point` text,
	`meeting_at` text,
	`payment_status` text DEFAULT 'quoted' NOT NULL,
	`payment_due_date` text,
	`card_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "segments_type_ck" CHECK("__new_segments"."type" in ('flight', 'event', 'hotel', 'rental_car', 'note', 'todo', 'parking', 'boat', 'train', 'directions', 'food', 'poi', 'meetup', 'rideshare', 'shuttle')),
	CONSTRAINT "segments_status_ck" CHECK("__new_segments"."status" in ('planned', 'checked_in', 'boarded', 'arrived', 'completed')),
	CONSTRAINT "segments_payment_status_ck" CHECK("__new_segments"."payment_status" in ('quoted', 'deposit_paid', 'fully_paid', 'refunded'))
);
--> statement-breakpoint
INSERT INTO `__new_segments`("id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "end_tz", "status", "location", "confirmation_number", "details_json", "meeting_point", "meeting_at", "payment_status", "payment_due_date", "card_id", "created_at", "updated_at") SELECT "id", "trip_id", "type", "title", "start_at", "start_tz", "end_at", "end_tz", "status", "location", "confirmation_number", "details_json", "meeting_point", "meeting_at", "payment_status", "payment_due_date", "card_id", "created_at", "updated_at" FROM `segments`;--> statement-breakpoint
DROP TABLE `segments`;--> statement-breakpoint
ALTER TABLE `__new_segments` RENAME TO `segments`;--> statement-breakpoint
CREATE INDEX `segments_trip_idx` ON `segments` (`trip_id`);--> statement-breakpoint
CREATE INDEX `segments_start_idx` ON `segments` (`start_at`);--> statement-breakpoint
CREATE TABLE `__new_travel_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`companion_id` integer,
	`type` text NOT NULL,
	`number` text,
	`issuing_authority` text,
	`expires_on` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "docs_type_ck" CHECK("__new_travel_documents"."type" in ('passport', 'drivers_license', 'global_entry', 'visa'))
);
--> statement-breakpoint
INSERT INTO `__new_travel_documents`("id", "user_id", "companion_id", "type", "number", "issuing_authority", "expires_on", "notes") SELECT "id", "user_id", "companion_id", "type", "number", "issuing_authority", "expires_on", "notes" FROM `travel_documents`;--> statement-breakpoint
DROP TABLE `travel_documents`;--> statement-breakpoint
ALTER TABLE `__new_travel_documents` RENAME TO `travel_documents`;--> statement-breakpoint
CREATE INDEX `docs_user_exp_idx` ON `travel_documents` (`user_id`,`expires_on`);--> statement-breakpoint
CREATE INDEX `docs_companion_idx` ON `travel_documents` (`companion_id`);--> statement-breakpoint
CREATE TABLE `__new_trip_companions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'adult' NOT NULL,
	`dietary` text,
	`allergies` text,
	`medical_notes` text,
	`needs_car_seat` integer DEFAULT false NOT NULL,
	`needs_stroller` integer DEFAULT false NOT NULL,
	`needs_crib` integer DEFAULT false NOT NULL,
	`needs_kids_meal` integer DEFAULT false NOT NULL,
	`child_ticket_discount` text,
	`seat_preference` text,
	`bed_preference` text,
	`accessibility_needs` text,
	`room_notes` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "companions_cat_ck" CHECK("__new_trip_companions"."category" in ('adult', 'child', 'other')),
	CONSTRAINT "companions_seat_ck" CHECK("__new_trip_companions"."seat_preference" is null or "__new_trip_companions"."seat_preference" in ('aisle', 'window', 'middle', 'none')),
	CONSTRAINT "companions_bed_ck" CHECK("__new_trip_companions"."bed_preference" is null or "__new_trip_companions"."bed_preference" in ('king', 'queen', 'twin', 'two_doubles', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_trip_companions`("id", "trip_id", "name", "category", "dietary", "allergies", "medical_notes", "needs_car_seat", "needs_stroller", "needs_crib", "needs_kids_meal", "child_ticket_discount", "seat_preference", "bed_preference", "accessibility_needs", "room_notes", "notes", "created_at") SELECT "id", "trip_id", "name", "category", "dietary", "allergies", "medical_notes", "needs_car_seat", "needs_stroller", "needs_crib", "needs_kids_meal", "child_ticket_discount", "seat_preference", "bed_preference", "accessibility_needs", "room_notes", "notes", "created_at" FROM `trip_companions`;--> statement-breakpoint
DROP TABLE `trip_companions`;--> statement-breakpoint
ALTER TABLE `__new_trip_companions` RENAME TO `trip_companions`;--> statement-breakpoint
CREATE INDEX `companions_trip_idx` ON `trip_companions` (`trip_id`);--> statement-breakpoint
CREATE TABLE `__new_trip_entry_requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`country` text NOT NULL,
	`requirement_type` text NOT NULL,
	`status` text DEFAULT 'needed' NOT NULL,
	`due_date` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entry_req_type_ck" CHECK("__new_trip_entry_requirements"."requirement_type" in ('visa', 'vaccination', 'other')),
	CONSTRAINT "entry_req_status_ck" CHECK("__new_trip_entry_requirements"."status" in ('needed', 'in_progress', 'complete', 'not_needed'))
);
--> statement-breakpoint
INSERT INTO `__new_trip_entry_requirements`("id", "trip_id", "country", "requirement_type", "status", "due_date", "notes", "created_at", "updated_at") SELECT "id", "trip_id", "country", "requirement_type", "status", "due_date", "notes", "created_at", "updated_at" FROM `trip_entry_requirements`;--> statement-breakpoint
DROP TABLE `trip_entry_requirements`;--> statement-breakpoint
ALTER TABLE `__new_trip_entry_requirements` RENAME TO `trip_entry_requirements`;--> statement-breakpoint
CREATE INDEX `entry_req_trip_idx` ON `trip_entry_requirements` (`trip_id`);--> statement-breakpoint
CREATE TABLE `__new_trip_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`category` text DEFAULT 'other',
	`exchange_rate` integer DEFAULT 10000 NOT NULL,
	`base_amount` integer DEFAULT 0 NOT NULL,
	`paid_by_companion_id` integer,
	`split_among` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paid_by_companion_id`) REFERENCES `trip_companions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expenses_category_ck" CHECK("__new_trip_expenses"."category" in ('lodging', 'transport', 'food', 'activities', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_trip_expenses`("id", "trip_id", "description", "amount", "currency", "category", "exchange_rate", "base_amount", "paid_by_companion_id", "split_among", "created_at") SELECT "id", "trip_id", "description", "amount", "currency", "category", "exchange_rate", "base_amount", "paid_by_companion_id", "split_among", "created_at" FROM `trip_expenses`;--> statement-breakpoint
DROP TABLE `trip_expenses`;--> statement-breakpoint
ALTER TABLE `__new_trip_expenses` RENAME TO `trip_expenses`;--> statement-breakpoint
CREATE INDEX `expenses_trip_idx` ON `trip_expenses` (`trip_id`);--> statement-breakpoint
CREATE TABLE `__new_trip_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` integer NOT NULL,
	`shared_with_user_id` integer,
	`shared_with_group_id` integer,
	`permission` text DEFAULT 'read' NOT NULL,
	`show_details` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shares_one_target_ck" CHECK(("__new_trip_shares"."shared_with_user_id" is not null) <> ("__new_trip_shares"."shared_with_group_id" is not null)),
	CONSTRAINT "shares_perm_ck" CHECK("__new_trip_shares"."permission" in ('read', 'edit'))
);
--> statement-breakpoint
INSERT INTO `__new_trip_shares`("id", "trip_id", "shared_with_user_id", "shared_with_group_id", "permission", "show_details", "created_at") SELECT "id", "trip_id", "shared_with_user_id", "shared_with_group_id", "permission", "show_details", "created_at" FROM `trip_shares`;--> statement-breakpoint
DROP TABLE `trip_shares`;--> statement-breakpoint
ALTER TABLE `__new_trip_shares` RENAME TO `trip_shares`;--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_user_uq` ON `trip_shares` (`trip_id`,`shared_with_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_trip_group_uq` ON `trip_shares` (`trip_id`,`shared_with_group_id`);--> statement-breakpoint
CREATE INDEX `shares_user_idx` ON `trip_shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `shares_group_idx` ON `trip_shares` (`shared_with_group_id`);--> statement-breakpoint
CREATE TABLE `__new_trips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`destination` text,
	`start_date` text,
	`end_date` text,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`default_visibility` text DEFAULT 'private' NOT NULL,
	`public_token` text,
	`public_token_expires_at` text,
	`public_show_details` integer DEFAULT false NOT NULL,
	`calendar_token` text,
	`calendar_token_expires_at` text,
	`base_currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "trips_vis_ck" CHECK("__new_trips"."default_visibility" in ('private', 'groups', 'public')),
	CONSTRAINT "trips_status_ck" CHECK("__new_trips"."status" in ('planning', 'booked', 'active', 'completed'))
);
--> statement-breakpoint
INSERT INTO `__new_trips`("id", "owner_id", "name", "destination", "start_date", "end_date", "notes", "tags", "archived", "favorite", "default_visibility", "public_token", "public_token_expires_at", "public_show_details", "calendar_token", "calendar_token_expires_at", "base_currency", "status", "created_at", "updated_at") SELECT "id", "owner_id", "name", "destination", "start_date", "end_date", "notes", "tags", "archived", "favorite", "default_visibility", "public_token", "public_token_expires_at", "public_show_details", "calendar_token", "calendar_token_expires_at", "base_currency", "status", "created_at", "updated_at" FROM `trips`;--> statement-breakpoint
DROP TABLE `trips`;--> statement-breakpoint
ALTER TABLE `__new_trips` RENAME TO `trips`;--> statement-breakpoint
CREATE UNIQUE INDEX `trips_public_token_unique` ON `trips` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `trips_calendar_token_unique` ON `trips` (`calendar_token`);--> statement-breakpoint
CREATE INDEX `trips_owner_idx` ON `trips` (`owner_id`);--> statement-breakpoint
CREATE INDEX `trips_start_idx` ON `trips` (`start_date`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`must_reset_password` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`flight_checkin_lead_hours` integer DEFAULT 24 NOT NULL,
	`document_expiry_lead_days` integer DEFAULT 90 NOT NULL,
	`email_notifications` integer DEFAULT true NOT NULL,
	`webhook_notifications` integer DEFAULT true NOT NULL,
	`theme_id` text DEFAULT 'midnight-travels' NOT NULL,
	`calendar_token` text,
	`calendar_token_expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "users_role_ck" CHECK("__new_users"."role" in ('admin', 'user')),
	CONSTRAINT "users_flight_lead_ck" CHECK("__new_users"."flight_checkin_lead_hours" >= 0),
	CONSTRAINT "users_doc_lead_ck" CHECK("__new_users"."document_expiry_lead_days" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "password_hash", "display_name", "role", "disabled", "must_reset_password", "timezone", "flight_checkin_lead_hours", "document_expiry_lead_days", "email_notifications", "webhook_notifications", "theme_id", "calendar_token", "calendar_token_expires_at", "created_at") SELECT "id", "email", "password_hash", "display_name", "role", "disabled", "must_reset_password", "timezone", "flight_checkin_lead_hours", "document_expiry_lead_days", "email_notifications", "webhook_notifications", "theme_id", "calendar_token", "calendar_token_expires_at", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_calendar_token_unique` ON `users` (`calendar_token`);--> statement-breakpoint
CREATE INDEX `fare_providers_user_idx` ON `fare_providers` (`user_id`);--> statement-breakpoint
CREATE INDEX `groups_owner_idx` ON `groups` (`owner_id`);--> statement-breakpoint
CREATE INDEX `ins_user_idx` ON `insurance_policies` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `expense_attachments_expense_idx` ON `trip_expense_attachments` (`expense_id`);--> statement-breakpoint
CREATE INDEX `home_tasks_trip_idx` ON `trip_home_tasks` (`trip_id`);--> statement-breakpoint
CREATE INDEX `important_items_trip_idx` ON `trip_important_items` (`trip_id`);--> statement-breakpoint
CREATE INDEX `important_items_companion_idx` ON `trip_important_items` (`companion_id`);--> statement-breakpoint
CREATE INDEX `medications_trip_idx` ON `trip_medications` (`trip_id`);--> statement-breakpoint
CREATE INDEX `medications_companion_idx` ON `trip_medications` (`companion_id`);--> statement-breakpoint
CREATE INDEX `trip_templates_user_idx` ON `trip_templates` (`user_id`);--> statement-breakpoint
CREATE INDEX `trip_templates_source_idx` ON `trip_templates` (`source_trip_id`);