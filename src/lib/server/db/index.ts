import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KitDatabase, migrateSync } from '@visorcraft/mongreldb-kit';
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

function isExistingDatabaseDirectory(path: string): boolean {
	if (!existsSync(path)) return false;
	const s = statSync(path);
	if (s.isDirectory()) {
		return existsSync(join(path, 'CATALOG'));
	}
	return true;
}

function openOrCreateEncryptedSync(path: string, passphrase: string): KitDatabase {
	if (isExistingDatabaseDirectory(path)) {
		return KitDatabase.openEncryptedSync(path, schema, passphrase);
	}
	return KitDatabase.createEncryptedSync(path, schema, passphrase);
}

export function getDb(): KitDatabase {
	if (!_kit) {
		const path = getDatabasePath();
		const passphrase = process.env.ROAMARR_SECRET;
		if (!passphrase) {
			throw new Error('ROAMARR_SECRET is required: it is used to encrypt the database at rest.');
		}
		_kit = openOrCreateEncryptedSync(path, passphrase);
		_kit.migrateSync(schema, migrations);
	}
	return _kit;
}

export function closeDb(): void {
	if (_kit) {
		_kit.close();
		_kit = null;
	}
}

export function getExistingDb(): KitDatabase | null {
	return _kit;
}

export const kit: KitDatabase = new Proxy({} as KitDatabase, {
	get(_t, p) {
		const real = getDb() as unknown as Record<PropertyKey, unknown>;
		const v = real[p as string];
		return typeof v === 'function' ? (v as (...a: never[]) => unknown).bind(real) : v;
	}
});
