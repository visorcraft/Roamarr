import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KitDatabase, Schema } from '@visorcraft/mongreldb-kit';
import { openKitDatabase } from './mongrel';
import { settings, benefitTemplates } from './mongrelSchema';
import { schema } from './mongrelSchema';
import { migrations } from './mongrelMigrations';
import { eq } from '@visorcraft/mongreldb-kit';

function openEncrypted(path: string, openSchema: Schema): KitDatabase {
	const passphrase = process.env.ROAMARR_SECRET;
	if (!passphrase) throw new Error('ROAMARR_SECRET must be set');
	return KitDatabase.createEncryptedSync(path, openSchema, passphrase);
}

describe('mongrelMigrations', () => {
	let tmpDir: string;
	let kit: Awaited<ReturnType<typeof openKitDatabase>>;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'roamarr-kit-migration-'));
		kit = await openKitDatabase(tmpDir);
	});

	afterEach(() => {
		kit.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test('0001_initial creates all tables and seeds settings row id 1', async () => {
		const row = await kit.selectFrom(settings).where(eq(settings.id, BigInt(1n))).execute();
		expect(row).toHaveLength(1);
		expect(row[0].id).toBe(1n);
		expect(row[0].instance_name).toBe('Roamarr');
	});

	test('0001_initial seeds default benefit templates', async () => {
		const rows = await kit.selectFrom(benefitTemplates).execute();
		expect(rows).toHaveLength(3);
		expect(rows.map((r) => r.name)).toEqual(
			expect.arrayContaining([
				'Trip delay reimbursement',
				'Baggage delay reimbursement',
				'Trip cancellation reimbursement'
			])
		);
	});

	test('migrations include the invitation upgrade for existing databases', () => {
		expect(migrations.map((migration) => migration.version)).toEqual([1, 2]);
		const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-weather-json-'));
		const db = openEncrypted(dir, schema);
		try {
			db.migrateSync(schema, migrations);
			const col = db.schema.table('weather_cache').column('payload_json');
			expect(col.applicationType).toBe('json');
		} finally {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

});
