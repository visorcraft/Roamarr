import type { Migration } from '@visorcraft/mongreldb-kit';
import { reminders, settings, tripMailHolds, users } from '../mongrelSchema';

/**
 * Trip mail holds, the owner's mail-hold reminder lead, and the instance
 * default for new users. Reminder kind and ref type gain `mail_hold`.
 *
 * The engine cannot widen a populated enum, so an old reminders table is
 * copied onto the widened schema (same approach as 0016). Fresh databases
 * already have the current enum and columns; addColumn and the copy no-op.
 * Lead columns are nullable so the add skips a NOT NULL row rewrite.
 */
export const mailHoldsMigration: Migration = {
	version: 18,
	name: 'mail_holds',
	ops: [
		{ kind: 'createTable', name: 'trip_mail_holds' },
		{ kind: 'addColumn', table: 'users', column: 'mail_hold_lead_days' },
		{ kind: 'addColumn', table: 'settings', column: 'default_mail_hold_lead_days' },
		{ kind: 'alterColumn', table: 'reminders', column: 'kind' },
		{ kind: 'alterColumn', table: 'reminders', column: 'ref_type' }
	],
	up: (ctx) => {
		ctx.ensureTable(tripMailHolds);
		ctx.addColumn('users', users.columns.find((c) => c.name === 'mail_hold_lead_days')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'default_mail_hold_lead_days')!);

		const db = ctx.db;
		const name = reminders.name;
		const staging = '__roamarr_reminders_v18';
		const backup = '__roamarr_reminders_v18_old';
		if (!db.tableNames().includes(name) && db.tableNames().includes(backup)) {
			db.renameTable(backup, name);
		}
		const specs = db.tableColumnSpecs(name);
		const kind = specs.find((c) => c.name === 'kind');
		const refType = specs.find((c) => c.name === 'ref_type');
		const widened =
			kind?.enumVariants?.includes('mail_hold') && refType?.enumVariants?.includes('mail_hold');
		if (!widened) {
			if (db.tableNames().includes(staging)) db.dropTable(staging);
			ctx.ensureTable({ ...reminders, name: staging });
			const source = db.table(name);
			const rows = source.query([]);
			if (BigInt(rows.length) !== source.count()) throw new Error('Reminder migration read is incomplete');
			const target = db.table(staging);
			if (rows.length > 0) {
				target.putBatch(rows.map((row) => row.cells));
				target.commit();
			}
			if (target.count() !== source.count()) throw new Error('Reminder migration copy is incomplete');
			db.renameTable(name, backup);
			try {
				db.renameTable(staging, name);
			} catch (error) {
				db.renameTable(backup, name);
				throw error;
			}
		}
		if (db.tableNames().includes(backup)) db.dropTable(backup);
		ctx.alterColumn(name, 'kind', reminders.columns.find((c) => c.name === 'kind')!);
		ctx.alterColumn(name, 'ref_type', reminders.columns.find((c) => c.name === 'ref_type')!);
	}
};
