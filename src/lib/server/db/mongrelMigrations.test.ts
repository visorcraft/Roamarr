import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KitDatabase, Schema, table, int, text, date, timestamp, unique, index, sequenceDefault } from '@visorcraft/mongreldb-kit';
import { openKitDatabase } from './mongrel';
import { settings, benefitTemplates, weatherCache } from './mongrelSchema';
import { schema } from './mongrelSchema';
import { migrations } from './mongrelMigrations';
import { migrations as migrations0010 } from './mongrelMigrations/0010_weather_payload_json_type';
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

	test('0010 declares payload_json as json after the full migration list', () => {
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

	test('0010 upgrades a legacy text payload_json column in place', () => {
		// Simulate a deployed database whose weather_cache.payload_json was
		// created as text before the json type migration existed.
		const legacyWeatherCache = table('weather_cache', {
			columns: [
				int('id', { primaryKey: true, default: sequenceDefault('weather_cache_id_seq') }),
				text('location_key'),
				date('for_date'),
				timestamp('fetched_at'),
				text('payload_json')
			],
			primaryKey: 'id',
			unique: [unique(['location_key', 'for_date'], { name: 'weather_cache_key_date_uq' })],
			indexes: [index(['fetched_at'], { name: 'weather_cache_fetched_idx' })]
		});

		const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-weather-upgrade-'));
		const db = openEncrypted(dir, new Schema([legacyWeatherCache]));
		try {
			const payload = JSON.stringify({ daily: { time: ['2026-01-01'] } });
			db.insertInto(legacyWeatherCache)
				.values({
					location_key: '48.86|2.35',
					for_date: '2026-01-01',
					fetched_at: new Date().toISOString(),
					payload_json: payload
				} as any)
				.executeSync();
			expect(legacyWeatherCache.column('payload_json').applicationType).toBe('text');

			// Apply just the type-alter migration against the current schema.
			db.migrateSync(schema, migrations0010);

			// Column metadata is now json; the row's UTF-8 bytes are untouched.
			expect(db.schema.table('weather_cache').column('payload_json').applicationType).toBe(
				'json'
			);
			const rows = db.selectFrom(weatherCache).executeSync();
			expect(rows).toHaveLength(1);
			expect(rows[0].payload_json).toBe(payload);
		} finally {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
