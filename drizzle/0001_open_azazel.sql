CREATE TABLE `geonames_cities` (
	`geoname_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ascii_name` text NOT NULL,
	`country_code` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`population` integer,
	`timezone` text
);
--> statement-breakpoint
CREATE INDEX `geonames_country_name_idx` ON `geonames_cities` (`country_code`,`name`);--> statement-breakpoint
CREATE INDEX `geonames_country_ascii_idx` ON `geonames_cities` (`country_code`,`ascii_name`);--> statement-breakpoint
ALTER TABLE `segments` ADD `country_code` text;--> statement-breakpoint
ALTER TABLE `segments` ADD `city_name` text;--> statement-breakpoint
ALTER TABLE `segments` ADD `city_lat` real;--> statement-breakpoint
ALTER TABLE `segments` ADD `city_lng` real;--> statement-breakpoint
ALTER TABLE `segments` ADD `venue` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`instance_name` text DEFAULT 'Roamarr' NOT NULL,
	`setup_complete` integer DEFAULT false NOT NULL,
	`allow_registration` integer DEFAULT false NOT NULL,
	`default_timezone` text DEFAULT 'UTC' NOT NULL,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`default_flight_checkin_lead_hours` integer DEFAULT 24 NOT NULL,
	`default_document_expiry_lead_days` integer DEFAULT 90 NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_pass` text,
	`smtp_from` text,
	`webhook_url` text,
	`maps_enabled` integer DEFAULT false NOT NULL,
	`maps_geonames_imported_at` text,
	`maps_tile_provider` text DEFAULT 'openstreetmap' NOT NULL,
	`maps_tile_url` text,
	`maps_tile_attribution` text,
	`maps_tile_api_key` text,
	CONSTRAINT "settings_tile_provider_ck" CHECK("__new_settings"."maps_tile_provider" in ('openstreetmap', 'carto', 'maptiler', 'stadia', 'thunderforest', 'jawg', 'protomaps', 'custom'))
);
--> statement-breakpoint
INSERT INTO `__new_settings`("id", "instance_name", "setup_complete", "allow_registration", "default_timezone", "default_currency", "default_flight_checkin_lead_hours", "default_document_expiry_lead_days", "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "webhook_url", "maps_enabled", "maps_geonames_imported_at", "maps_tile_provider", "maps_tile_url", "maps_tile_attribution", "maps_tile_api_key") SELECT "id", "instance_name", "setup_complete", "allow_registration", "default_timezone", "default_currency", "default_flight_checkin_lead_hours", "default_document_expiry_lead_days", "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from", "webhook_url", "maps_enabled", "maps_geonames_imported_at", "maps_tile_provider", "maps_tile_url", "maps_tile_attribution", "maps_tile_api_key" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;