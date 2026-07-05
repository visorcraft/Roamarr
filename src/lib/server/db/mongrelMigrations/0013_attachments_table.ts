import type { Migration } from '@visorcraft/mongreldb-kit';
import { attachments, tripExpenseAttachments } from '../mongrelSchema';

const attachmentsTableMigration: Migration = {
	version: 13,
	name: 'attachments_table',
	up: (ctx) => {
		// The old trip_expense_attachments table stored attachment metadata inline.
		// We are replacing it with a generic attachments table and a link table.
		// Since Roamarr has no production users, dropping the old table is acceptable,
		// but synchronous migrations cannot safely run DROP TABLE via SQL (ctx.sql
		// is unavailable in migrateSync and ctx.kit.sql is async). Existing dev
		// databases should be reset; fresh databases get the new schema directly.
		ctx.ensureTable(attachments);
		ctx.ensureTable(tripExpenseAttachments);
	}
};

export const migrations = [attachmentsTableMigration];
