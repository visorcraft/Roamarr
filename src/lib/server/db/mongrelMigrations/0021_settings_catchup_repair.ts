import type { Migration } from '@visorcraft/mongreldb-kit';
import { eq } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

const settingsCatchupRepairMigration: Migration = {
	version: 21,
	name: 'settings_catchup_repair',
	up: (ctx) => {
		const cols = ctx.db.tableColumns('settings');
		for (const name of ['default_date_format', 'default_datetime_format']) {
			const col = settings.columns.find((c) => c.name === name);
			if (col && !cols.includes(name)) ctx.addColumn('settings', col);
		}

		const rows = ctx.kit.selectFrom(settings).executeSync();
		if (rows.length === 0) return;
		const row = rows[0];
		const patch: Record<string, unknown> = {};
		if (row.default_date_format == null) patch.default_date_format = 'yyyy-MM-dd';
		if (row.default_datetime_format == null) patch.default_datetime_format = 'yyyy-MM-dd h:mm a';
		if (row.default_flight_checkin_lead_hours == null) patch.default_flight_checkin_lead_hours = 24n;
		if (row.default_document_expiry_lead_days == null) patch.default_document_expiry_lead_days = 90n;
		if (Object.keys(patch).length > 0) {
			ctx.kit.updateTable(settings).set(patch).where(eq(settings.id, row.id)).executeSync();
		}
	}
};

export const migrations = [settingsCatchupRepairMigration];
