import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

const settingsDateFormatsMigration: Migration = {
	version: 18,
	name: 'settings_date_formats',
	ops: [
		{ kind: 'addColumn', table: 'settings', column: 'default_date_format' },
		{ kind: 'addColumn', table: 'settings', column: 'default_datetime_format' }
	],
	up: (ctx) => {
		// Columns are declared nullable (with a kit-level default) because
		// mongreldb's engine rejects addColumn of a NOT NULL column on a
		// populated table regardless of any default expression. We add them
		// nullable, then backfill the singleton settings row below so reads
		// always see a real value.
		const cols = ctx.db.tableColumns('settings');
		const dateCol = settings.columns.find((c) => c.name === 'default_date_format');
		if (dateCol && !cols.includes('default_date_format')) {
			ctx.addColumn('settings', dateCol);
		}
		const datetimeCol = settings.columns.find((c) => c.name === 'default_datetime_format');
		if (datetimeCol && !cols.includes('default_datetime_format')) {
			ctx.addColumn('settings', datetimeCol);
		}

		// Backfill the singleton settings row with the defaults so existing
		// instances pick up the new format columns without a write race.
		ctx.kit
			.updateTable(settings)
			.set({
				default_date_format: 'yyyy-MM-dd',
				default_datetime_format: 'yyyy-MM-dd h:mm a'
			})
			.executeSync();
	}
};

export const migrations = [settingsDateFormatsMigration];
