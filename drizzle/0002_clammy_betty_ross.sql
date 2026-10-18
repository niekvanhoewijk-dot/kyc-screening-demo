CREATE TABLE `document_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`extraction` text,
	`error` text,
	`reader` text NOT NULL,
	`model` text,
	`prompt_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `cases` ADD `pre_review` text;