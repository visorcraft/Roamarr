import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';
import { nowIso } from '../../tz';

/**
 * Defensive repair of the singleton settings row.
 *
 * When a column is added to a populated table, the engine leaves it unset for
 * existing rows. The mongreldb engine tends to return a `0n` sentinel (BigInt
 * zero) for those unset slots, regardless of the column's declared storage
 * type. The kit's `updateTable(...).set()` re-validates the WHOLE merged row
 * against the schema, so even a single wrong-typed or null-non-nullable value
 * blocks every settings write — not just writes to that column.
 *
 * This migration walks every column on the settings table, checks the stored
 * value against the column's expected storage type, and patches any value
 * that is null-when-not-nullable OR wrong-typed back to the declared default
 * (or to null when the column is nullable and has no default). After this
 * runs, every column on the singleton row passes kit validation, which
 * unblocks all subsequent `updateTable` calls.
 */
const settingsBackfillDefaultsMigration: Migration = {
	version: 19,
	name: 'settings_backfill_defaults',
	up: (ctx) => {
		const cols = ctx.db.tableColumns('settings');
		const rows = ctx.kit.selectFrom(settings).executeSync();
		if (rows.length === 0) return;
		const row = rows[0] as Record<string, unknown>;

		function typeOk(storageType: string, value: unknown): boolean {
			switch (storageType) {
				case 'bool':
					return typeof value === 'boolean';
				case 'int64':
					return typeof value === 'bigint';
				case 'float64':
					return typeof value === 'number';
				case 'text':
				case 'timestamp':
				case 'date':
					return typeof value === 'string';
				case 'bytes':
					return value instanceof Uint8Array;
				default:
					return true;
			}
		}

		function defaultValue(col: { default?: { kind: string; value?: unknown; fn?: () => unknown } | null }): unknown {
			const source = col.default ?? undefined;
			if (!source) return undefined;
			if (source.kind === 'static') return source.value;
			if (source.kind === 'now') return nowIso();
			if (source.kind === 'custom' && typeof source.fn === 'function') return source.fn();
			return undefined;
		}

		const patch: Record<string, unknown> = {};
		for (const col of settings.columns) {
			if (!cols.includes(col.name)) continue;
			// Skip the primary key — never overwrite it.
			if (settings.primaryKey.includes(col.name)) continue;

			const current = row[col.name];
			const currentIsNullOrMissing = current === null || current === undefined;
			const currentTypeOk = !currentIsNullOrMissing && typeOk(col.storageType, current);

			if (currentTypeOk) continue; // value is fine, leave it alone

			// Value is wrong: try the declared default first, then fall back to
			// null when the column is nullable. Non-nullable columns without a
			// default cannot be repaired here — skip and let the kit surface it.
			const def = defaultValue(col);
			if (def !== undefined && def !== null && typeOk(col.storageType, def)) {
				patch[col.name] = def;
			} else if (col.nullable) {
				patch[col.name] = null;
			}
			// else: cannot repair — leave for the kit to complain about so the
			// operator sees a precise error.
		}

		if (Object.keys(patch).length === 0) return;
		ctx.kit.updateTable(settings).set(patch).executeSync();
	}
};

export const migrations = [settingsBackfillDefaultsMigration];
