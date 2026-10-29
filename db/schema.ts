import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Metadata only. Recruiting values and provider credentials never enter this ledger.
export const recruitWriteRequests = sqliteTable('recruit_write_requests', {
  userId: text('user_id').notNull(),
  requestId: text('request_id').notNull(),
  ticketId: text('ticket_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  status: text('status', { enum: ['pending', 'saved', 'failed', 'uncertain'] }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.requestId] }),
  uniqueIndex('recruit_write_one_pending_ticket').on(table.ticketId).where(sql`${table.status} = 'pending'`),
]);
