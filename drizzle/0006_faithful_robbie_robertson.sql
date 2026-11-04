CREATE TABLE `policy_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`settings` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sim_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`customer` text NOT NULL,
	`updated_at` text NOT NULL
);
