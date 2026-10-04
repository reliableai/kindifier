import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const connections = sqliteTable('connections', {
 user_id:text('user_id').primaryKey(), account:text('account').notNull(), ciphertext:text('ciphertext').notNull(), connection_id:text('connection_id').notNull().default(''),
});
export const oauthStates = sqliteTable('oauth_states', {
 state_hash:text('state_hash').primaryKey(), user_id:text('user_id').notNull(), verifier:text('verifier').notNull(), expires_at:integer('expires_at').notNull(),
});
export const rewrites = sqliteTable('rewrites', {
 user_id:text('user_id').notNull(), account:text('account').notNull(), message_id:text('message_id').notNull(), ciphertext:text('ciphertext').notNull(), created_at:integer('created_at').notNull(),
}, t=>[primaryKey({columns:[t.user_id,t.account,t.message_id]})]);
export const drafts = sqliteTable('drafts', {
 user_id:text('user_id').notNull(), account:text('account').notNull(), id:text('id').notNull(), ciphertext:text('ciphertext').notNull(), updated_at:integer('updated_at').notNull(), revision:integer('revision').notNull().default(0),
}, t=>[primaryKey({columns:[t.user_id,t.account,t.id]})]);
export const sends = sqliteTable('sends', {
 user_id:text('user_id').notNull(), account:text('account').notNull(), id:text('id').notNull(), digest:text('digest').notNull(), status:text('status').notNull(), gmail_id:text('gmail_id'), created_at:integer('created_at').notNull(),
}, t=>[primaryKey({columns:[t.user_id,t.account,t.id]})]);
