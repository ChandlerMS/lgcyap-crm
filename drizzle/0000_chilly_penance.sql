CREATE TABLE `recruit_write_requests` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `request_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recruit_write_one_pending_ticket` ON `recruit_write_requests` (`ticket_id`) WHERE "recruit_write_requests"."status" = 'pending';