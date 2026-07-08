import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

const nullableSettingsLeadsMigration: Migration = {
	version: 20,
	name: 'nullable_settings_leads',
	up: (ctx) => {
		for (const name of ['default_flight_checkin_lead_hours', 'default_document_expiry_lead_days']) {
			const col = settings.columns.find((c) => c.name === name);
			if (col && ctx.db.tableColumns('settings').includes(name)) {
				ctx.alterColumn('settings', name, col);
			}
		}
	}
};

export const migrations = [nullableSettingsLeadsMigration];
