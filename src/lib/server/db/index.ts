import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KitDatabase } from '@visorcraft/mongreldb-kit';
import { schema } from './mongrelSchema';
import { migrations } from './mongrelMigrations';
import { getDatabasePath } from './paths';

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

/**
 * Per-table cap on the decoded result cache. The engine default can retain an
 * unbounded amount of decoded query results, which reads as a slow,
 * restart-cured memory climb over a long uptime. 32 MiB per table is generous
 * enough to keep normal caching effective while preventing runaway growth.
 * Failures are swallowed so a cap can never break boot.
 */
const RESULT_CACHE_MAX_BYTES = 32 * 1024 * 1024;

function capResultCaches(handle: KitDatabase): void {
	let names: string[];
	try {
		names = handle.tableNames();
	} catch {
		return;
	}
	for (const name of names) {
		try {
			handle.setTableResultCacheMaxBytes(name, RESULT_CACHE_MAX_BYTES);
		} catch {
			// A table rejecting the cap must never break boot.
		}
	}
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
		capResultCaches(_kit);
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
