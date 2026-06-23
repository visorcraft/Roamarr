import type Database from 'better-sqlite3';
import { createDb, type DB } from './createDb';
import * as schema from './schema';

export { createDb, type DB, schema };

// Lazy singleton: the DB file is only opened on first property access, not at
// import time. This keeps SvelteKit's build-time server analysis side-effect-free
// (it imports this module but never queries it), while real runtime traffic
// (and bootApp) triggers the connection.
let _instance: ReturnType<typeof createDb> | null = null;
function instance() {
	if (!_instance) _instance = createDb(process.env.DATABASE_PATH ?? '/data/roamarr.db');
	return _instance;
}

export const db: DB = new Proxy({} as DB, {
	get(_t, p) {
		const real = instance().db as unknown as Record<PropertyKey, unknown>;
		const v = real[p as string];
		return typeof v === 'function' ? (v as (...a: never[]) => unknown).bind(real) : v;
	}
});

export const sqlite: Database.Database = new Proxy({} as Database.Database, {
	get(_t, p) {
		const real = instance().sqlite as unknown as Record<PropertyKey, unknown>;
		const v = real[p as string];
		return typeof v === 'function' ? (v as (...a: never[]) => unknown).bind(real) : v;
	}
});
