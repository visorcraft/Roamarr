import type Database from 'better-sqlite3';
import { KitDatabase, migrateSync } from '@mongreldb/kit';
import { createDb, type DB } from './createDb';
import { getDatabasePath as getLegacyDatabasePath } from '../paths';
import { getDatabasePath } from './paths';
import { schema } from './mongrelSchema';
import { migrations } from './mongrelMigrations/0001_initial';

export type { DB };

// Legacy Drizzle singleton: the DB file is only opened on first property access,
// not at import time. Keep these available while the rest of the app is migrated
// to the MongrelDB Kit.
let _legacyInstance: ReturnType<typeof createDb> | null = null;
function legacyInstance() {
	if (!_legacyInstance) _legacyInstance = createDb(getLegacyDatabasePath());
	return _legacyInstance;
}

export const db: DB = new Proxy({} as DB, {
	get(_t, p) {
		const real = legacyInstance().db as unknown as Record<PropertyKey, unknown>;
		const v = real[p as string];
		return typeof v === 'function' ? (v as (...a: never[]) => unknown).bind(real) : v;
	}
});

export const sqlite: Database.Database = new Proxy({} as Database.Database, {
	get(_t, p) {
		const real = legacyInstance().sqlite as unknown as Record<PropertyKey, unknown>;
		const v = real[p as string];
		return typeof v === 'function' ? (v as (...a: never[]) => unknown).bind(real) : v;
	}
});

// MongrelDB Kit synchronous singleton. Lazily opens the kit database and applies
// migrations on first access so that build-time imports remain side-effect-free.
let _kit: KitDatabase | null = null;

export function getDb(): KitDatabase {
	if (!_kit) {
		_kit = KitDatabase.openSync(getDatabasePath(), schema);
		_kit.migrateSync(schema, migrations);
	}
	return _kit;
}

export const kit: KitDatabase = new Proxy({} as KitDatabase, {
	get(_t, p) {
		const real = getDb() as unknown as Record<PropertyKey, unknown>;
		const v = real[p as string];
		return typeof v === 'function' ? (v as (...a: never[]) => unknown).bind(real) : v;
	}
});
