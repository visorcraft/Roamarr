import { getDb } from './db';
import { validateSecretFormat } from './crypto';

export interface SetupCheckResult {
	secretPresent: boolean;
	encrypted: boolean;
	writable: boolean;
	error?: string;
}

/**
 * Validate the preconditions for running setup:
 * - ROAMARR_SECRET is present and is a base64-encoded 32-byte value
 * - The MongrelDB Kit database can be opened/migrated
 * - The database is writable (smoke test: create/write/read/delete a temp table)
 */
export async function validateSetupDb(): Promise<SetupCheckResult> {
	if (!process.env.ROAMARR_SECRET) {
		return {
			secretPresent: false,
			encrypted: false,
			writable: false,
			error: 'ROAMARR_SECRET is not set.'
		};
	}

	const validation = validateSecretFormat(process.env.ROAMARR_SECRET);
	if (!validation.ok) {
		return {
			secretPresent: true,
			encrypted: false,
			writable: false,
			error: validation.error
		};
	}

	try {
		const db = getDb();

		// Opening the DB already proves it is encrypted with ROAMARR_SECRET.
		const encrypted = true;

		// Verify the schema/migrations loaded by listing tables.
		db.tableNames();

		// Smoke-test write/read/delete using a throwaway SQL table.
		await db.sql(`CREATE TABLE IF NOT EXISTS __roamarr_setup_test (value TEXT)`);
		await db.sql(`INSERT INTO __roamarr_setup_test VALUES ('setup-check')`);
		const rows = await db.sqlRows(`SELECT value FROM __roamarr_setup_test WHERE value = 'setup-check'`);
		if (rows.length !== 1) {
			throw new Error('Database write/read mismatch.');
		}
		await db.sql(`DELETE FROM __roamarr_setup_test`);
		await db.sql(`DROP TABLE __roamarr_setup_test`);

		return { secretPresent: true, encrypted, writable: true };
	} catch (e) {
		return {
			secretPresent: true,
			encrypted: false,
			writable: false,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}
