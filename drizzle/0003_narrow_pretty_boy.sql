CREATE TABLE `screening_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`provider` text NOT NULL,
	`list_version` text NOT NULL,
	`entry_id` text NOT NULL,
	`entry_name` text NOT NULL,
	`category` text NOT NULL,
	`program` text NOT NULL,
	`match` text NOT NULL,
	`strength` text NOT NULL,
	`status` text NOT NULL,
	`triaged_by` text,
	`triage_reason` text,
	`triaged_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cases` ADD `edd_request` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `edd_submission` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `edd_result` text;