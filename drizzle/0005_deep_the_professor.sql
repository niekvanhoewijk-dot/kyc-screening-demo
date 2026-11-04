CREATE TABLE `decision_records` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`policy_id` text NOT NULL,
	`record` text NOT NULL,
	`hash` text NOT NULL,
	`prev_hash` text,
	`at_wall` text NOT NULL
);
