CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `attempt_answer` ADD `answered_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_answer_uq` ON `attempt_answer` (`attempt_id`,`question_id`);--> statement-breakpoint
ALTER TABLE `attempt` ADD `target_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `attempt` ADD `number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `covered` integer;--> statement-breakpoint
ALTER TABLE `job` ADD `ctx` text;--> statement-breakpoint
ALTER TABLE `package` ADD `sha` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `question` ADD `chapter` text;--> statement-breakpoint
ALTER TABLE `question` ADD `lesson_id` text;--> statement-breakpoint
ALTER TABLE `question` ADD `domain` text;--> statement-breakpoint
ALTER TABLE `question` ADD `report_reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `xp_event_reason_ref_uq` ON `xp_event` (`reason`,`ref`);