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

export function openOrCreateEncryptedSync(
	path: string,
	passphrase: string,
	credentials?: { username: string; password: string }
): KitDatabase {
	// Prefer the unified openSync options form for existing DBs (encryption +
	// optional credentials). Create still needs the explicit create* helpers so
	// credentialed first-boot enables require_auth with a bootstrap admin.
	if (isExistingDatabaseDirectory(path)) {
		return KitDatabase.openSync(
			path,
			schema,
			credentials
				? { encryption: { passphrase }, credentials }
				: { encryption: { passphrase } }
		);
	}
	return credentials
		? KitDatabase.createEncryptedWithCredentialsSync(
				path,
				schema,
				passphrase,
				credentials.username,
				credentials.password
			)
		: KitDatabase.createEncryptedSync(path, schema, passphrase);
}

export function databaseCredentialsFromEnv(): { username: string; password: string } | undefined {
	const username = process.env.DATABASE_USER;
	const password = process.env.DATABASE_PASS;
	if (!username && !password) return undefined;
	if (!username || !password) throw new Error('DATABASE_USER and DATABASE_PASS must both be set.');
	return { username, password };
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
		_kit = openOrCreateEncryptedSync(path, passphrase, databaseCredentialsFromEnv());
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
