CREATE TABLE `wallet_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`nonce` text NOT NULL,
	`audience` text NOT NULL,
	`requested` text NOT NULL,
	`status` text NOT NULL,
	`result_code` text,
	`presentation_sha256` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
