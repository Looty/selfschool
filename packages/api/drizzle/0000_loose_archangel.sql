CREATE TABLE `attempt_answer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer` text,
	`correct` integer,
	`marks` real,
	`grader` text NOT NULL,
	`feedback` text,
	`job_id` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`kind` text NOT NULL,
	`quiz_id` text,
	`exam_instance_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`score` real,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exam_instance_id`) REFERENCES `exam_instance`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chat_message` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations` text NOT NULL,
	`job_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `completion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`revision` integer NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completion_uq` ON `completion` (`package_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `exam_instance` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`exam_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`questions` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_status_created_idx` ON `job` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `lesson_revision` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_revision_uq` ON `lesson_revision` (`package_id`,`lesson_id`,`revision`);--> statement-breakpoint
CREATE TABLE `package` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`ref` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`schema_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `question` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`concepts` text NOT NULL,
	`difficulty` integer,
	`sources` text NOT NULL,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `package`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_hash_uq` ON `question` (`package_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `xp_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`ref` text
);
