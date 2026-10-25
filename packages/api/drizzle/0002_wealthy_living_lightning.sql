CREATE TABLE `extension` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`status` text NOT NULL,
	`seed` text NOT NULL,
	`job_id` text,
	`error` text,
	`outline` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action
);
