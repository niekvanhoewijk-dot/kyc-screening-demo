CREATE TABLE `intake_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`step` text NOT NULL,
	`field` text NOT NULL,
	`value` text,
	`source` text NOT NULL,
	`client_id` text,
	`client_name` text,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_drafts_case_step_field` ON `intake_drafts` (`case_id`,`step`,`field`);