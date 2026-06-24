CREATE TABLE `benefit_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`benefit_type` text NOT NULL,
	`name` text NOT NULL,
	`coverage_amount` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text,
	CONSTRAINT "benefit_template_type_ck" CHECK("benefit_templates"."benefit_type" in ('trip_delay','baggage_delay','trip_cancellation','other'))
);
--> statement-breakpoint
INSERT INTO `benefit_templates` (`benefit_type`,`name`,`coverage_amount`,`currency`,`description`) VALUES
('trip_delay','Trip delay reimbursement',50000,'USD','Reimburses meals, lodging and transport when a trip is delayed.'),
('baggage_delay','Baggage delay reimbursement',10000,'USD','Reimburses essential purchases when checked baggage is delayed.'),
('trip_cancellation','Trip cancellation reimbursement',100000,'USD','Reimburses non-refundable trip costs if you cancel for a covered reason.');
