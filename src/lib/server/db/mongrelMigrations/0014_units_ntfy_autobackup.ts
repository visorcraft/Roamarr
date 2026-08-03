import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings, users } from '../mongrelSchema';

/**
 * Phase 11 quality-of-life bundle:
 * - per-user display preferences (`temperature_unit`, `time_format`) and the
 *   per-user ntfy channel toggle (`ntfy_notifications`);
 * - admin-configured instance-wide ntfy channel (`ntfy_server_url`,
 *   `ntfy_topic`, `ntfy_token` — the token is encrypted at rest);
 * - scheduled automatic backups (`backup_auto_enabled`,
 *   `backup_interval_hours`, `backup_retention_count`, `backup_last_auto_at`).
 *
 * All columns are nullable with static defaults. A NOT NULL add rewrites every
 * row against the full target schema (see 0013's note), so several NOT NULL
 * columns cannot be added in one migration; nullable columns skip the backfill
 * entirely and readers coalesce null to the default.
 */
export const unitsNtfyAutoBackupMigration: Migration = {
	version: 14,
	name: 'units_ntfy_autobackup',
	ops: [
		{ kind: 'addColumn', table: 'users', column: 'temperature_unit' },
		{ kind: 'addColumn', table: 'users', column: 'time_format' },
		{ kind: 'addColumn', table: 'users', column: 'ntfy_notifications' },
		{ kind: 'addColumn', table: 'settings', column: 'ntfy_server_url' },
		{ kind: 'addColumn', table: 'settings', column: 'ntfy_topic' },
		{ kind: 'addColumn', table: 'settings', column: 'ntfy_token' },
		{ kind: 'addColumn', table: 'settings', column: 'backup_auto_enabled' },
		{ kind: 'addColumn', table: 'settings', column: 'backup_interval_hours' },
		{ kind: 'addColumn', table: 'settings', column: 'backup_retention_count' },
		{ kind: 'addColumn', table: 'settings', column: 'backup_last_auto_at' }
	],
	up: (ctx) => {
		ctx.addColumn('users', users.columns.find((c) => c.name === 'temperature_unit')!);
		ctx.addColumn('users', users.columns.find((c) => c.name === 'time_format')!);
		ctx.addColumn('users', users.columns.find((c) => c.name === 'ntfy_notifications')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'ntfy_server_url')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'ntfy_topic')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'ntfy_token')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'backup_auto_enabled')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'backup_interval_hours')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'backup_retention_count')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'backup_last_auto_at')!);
	}
};
