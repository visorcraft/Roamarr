import { KitDatabase, migrateSync } from '@mongreldb/kit';
import { schema } from './mongrelSchema';
import { migrations } from './mongrelMigrations';
import { getDatabasePath } from './paths';

// Backwards-compatible type alias for tests and transitional code that still
// references the old DB shape. This will be removed once all call sites are
// fully migrated to the kit singleton.
export type DB = any;

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
