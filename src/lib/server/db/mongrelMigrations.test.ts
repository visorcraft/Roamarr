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
		expect(migrations.map((migration) => migration.version)).toEqual([1, 2, 3, 4]);
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

	test('0004 adds settings.embeddings_config when the native column is missing', () => {
		// Reproduce the 0003 bug state: settings exists without embeddings_config.
		// (0003 used alterColumn, which never calls native add_column for a new field.)
		const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-embeddings-col-'));
		const passphrase = process.env.ROAMARR_SECRET!;
		// filter() widens the column tuple to an array; double-cast for the partial table.
		const settingsWithoutEmbeddings = {
			...settings,
			columns: settings.columns.filter((c) => c.name !== 'embeddings_config')
		} as unknown as typeof settings;
		const partialSchema = new Schema(
			schema.tablesList().map((t) => (t.name === 'settings' ? settingsWithoutEmbeddings : t))
		);
		const pre = KitDatabase.createEncryptedSync(dir, partialSchema, passphrase);
		try {
			const nativeCols = pre.nativeDb.tableColumnSpecs('settings').map((c) => c.name);
			expect(nativeCols).not.toContain('embeddings_config');
		} finally {
			pre.close();
		}

		const post = KitDatabase.openSync(dir, schema, { encryption: { passphrase } });
		try {
			// Only migration 4 is needed to repair; 1–3 are irrelevant to this gap.
			post.migrateSync(
				schema,
				migrations.filter((m) => m.version === 4)
			);
			const nativeCols = post.nativeDb.tableColumnSpecs('settings').map((c) => c.name);
			expect(nativeCols).toContain('embeddings_config');

			// Full-row insert must succeed (this is what failed with column id 28).
			post
				.insertInto(settings)
				.values({
					id: 99n,
					instance_name: 'probe',
					setup_complete: true,
					allow_registration: false,
					default_timezone: 'UTC',
					default_currency: 'USD',
					default_date_format: 'yyyy-MM-dd',
					default_datetime_format: 'yyyy-MM-dd h:mm a',
					default_flight_checkin_lead_hours: 24n,
					default_document_expiry_lead_days: 90n,
					email_poll_interval_minutes: 5n,
					maps_enabled: false,
					maps_tile_provider: 'openstreetmap',
					session_cookie_same_site: 'lax',
					embeddings_config: null
				} as never)
				.executeSync();
		} finally {
			post.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

});
