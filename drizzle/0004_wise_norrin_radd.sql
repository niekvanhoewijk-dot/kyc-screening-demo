CREATE TABLE `case_persons` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`full_name` text NOT NULL,
	`date_of_birth` text NOT NULL,
	`nationality` text NOT NULL,
	`country_of_residence` text NOT NULL,
	`roles` text NOT NULL,
	`share_percent` text,
	`pep` integer NOT NULL,
	`is_applicant` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `cases` ADD `company` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `persons_step` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `company_docs_step` text;--> statement-breakpoint
ALTER TABLE `cases` ADD `memo` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `person_id` text;--> statement-breakpoint
ALTER TABLE `screening_hits` ADD `subject` text;