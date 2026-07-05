import type { Migration } from '@visorcraft/mongreldb-kit';
import { attachments, tripExpenseAttachments } from '../mongrelSchema';

const attachmentsTableMigration: Migration = {
	version: 13,
	name: 'attachments_table',
	up: (ctx) => {
		// The old trip_expense_attachments table stored attachment metadata inline.
		// We are replacing it with a generic attachments table and a link table.
		// Since Roamarr has no production users, dropping the old table is acceptable.
		// ctx.sql is unavailable in synchronous migrations, so use the native DB.
		// Only drop when the existing table has the old inline-metadata shape;
		// recreating an already-correct link table in the same DB session can leave
		// the native table metadata in a state where Kit inserts fail.
		if (ctx.db.tableNames().includes('trip_expense_attachments')) {
			const cols = ctx.db.tableColumns('trip_expense_attachments');
			if (cols.includes('filename') || cols.includes('storage_key') || cols.includes('content_type')) {
				ctx.db.dropTable('trip_expense_attachments');
			}
		}
		ctx.ensureTable(attachments);
		ctx.ensureTable(tripExpenseAttachments);
	}
};

export const migrations = [attachmentsTableMigration];
