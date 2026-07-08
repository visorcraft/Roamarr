import type { Migration } from '@visorcraft/mongreldb-kit';
import { kitUniqueKeys, eq } from '@visorcraft/mongreldb-kit';
import { reminders } from '../mongrelSchema';

const remindersUserFieldsMigration: Migration = {
	version: 17,
	name: 'reminders_user_fields',
	ops: [
		{ kind: 'dropUnique', table: 'reminders', constraint: 'rem_source_uq' },
		{ kind: 'addIndex', table: 'reminders', index: 'rem_user_idx' },
		{ kind: 'addColumn', table: 'reminders', column: 'name' },
		{ kind: 'addColumn', table: 'reminders', column: 'description' }
	],
	up: (ctx) => {
		// Drop the legacy (kind, ref_type, ref_id) unique constraint. System
		// reminders still dedup via upsertReminderBySource's lookup-then-insert;
		// user-created custom reminders need to allow multiple rows per ref.
		ctx.kit
			.deleteFrom(kitUniqueKeys)
			.where(eq(kitUniqueKeys.constraint_name, 'rem_source_uq'))
			.executeSync();
		const tableSpec = ctx.kit.schema.table('reminders');
		tableSpec.unique = tableSpec.unique.filter((u) => u.name !== 'rem_source_uq');

		// Add user-facing name + description columns (nullable; system reminders
		// keep null and the UI derives a display name from kind/ref).
		const nameCol = reminders.columns.find((c) => c.name === 'name');
		if (nameCol && !ctx.db.tableColumns('reminders').includes('name')) {
			ctx.addColumn('reminders', nameCol);
		}
		const descCol = reminders.columns.find((c) => c.name === 'description');
		if (descCol && !ctx.db.tableColumns('reminders').includes('description')) {
			ctx.addColumn('reminders', descCol);
		}
	}
};

export const migrations = [remindersUserFieldsMigration];
