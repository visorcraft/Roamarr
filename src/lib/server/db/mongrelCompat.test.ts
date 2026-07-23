/**
 * Cross-version on-disk compatibility gate.
 *
 * Opens a committed sample database produced by a prior (or current) install of
 * @visorcraft/mongreldb + kit, applies any pending app migrations, and asserts
 * known rows remain readable and writable. Fails when a package upgrade cannot
 * open, migrate, or read a real on-disk layout.
 *
 * Fixture: tests/fixtures/mongreldb/sample-db.tar.gz
 * Refresh: npm run db:compat-fixture
 */
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { describe, test, expect, afterEach } from 'vitest';
import tar from 'tar-fs';
import mongreldb from '@visorcraft/mongreldb';
import { KitDatabase, eq } from '@visorcraft/mongreldb-kit';
import { schema, settings, users, trips, segments } from './mongrelSchema';
import { migrations } from './mongrelMigrations';

const fixtureDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../tests/fixtures/mongreldb'
);
const archivePath = join(fixtureDir, 'sample-db.tar.gz');
const manifestPath = join(fixtureDir, 'manifest.json');

type CompatManifest = {
	archiveRootEntry: string;
	passphrase: string;
	enginePackageVersion: string | null;
	kitPackageVersion: string | null;
	engineVersion: string;
	migrationVersions: number[];
	expected: {
		settingsInstanceName: string;
		userEmail: string;
		userDisplayName: string;
		tripName: string;
		tripDestination: string;
		segmentTitle: string;
		segmentType: string;
	};
};

function loadManifest(): CompatManifest {
	expect(existsSync(manifestPath), `missing ${manifestPath}`).toBe(true);
	expect(existsSync(archivePath), `missing ${archivePath}`).toBe(true);
	return JSON.parse(readFileSync(manifestPath, 'utf8')) as CompatManifest;
}

async function extractFixture(destRoot: string, rootEntry: string): Promise<string> {
	mkdirSync(destRoot, { recursive: true });
	await pipeline(createReadStream(archivePath), createGunzip(), tar.extract(destRoot));
	const dbPath = join(destRoot, rootEntry);
	expect(existsSync(join(dbPath, 'CATALOG')), 'fixture archive missing CATALOG').toBe(true);
	expect(existsSync(join(dbPath, 'tables')), 'fixture archive missing tables/').toBe(true);
	return dbPath;
}

describe('MongrelDB cross-version sample database', () => {
	const cleanupDirs: string[] = [];

	afterEach(() => {
		for (const dir of cleanupDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('opens the committed fixture, migrates, and reads golden rows', async () => {
		const manifest = loadManifest();
		const extractRoot = mkdtempSync(join(tmpdir(), 'roamarr-compat-open-'));
		cleanupDirs.push(extractRoot);

		const dbPath = await extractFixture(extractRoot, manifest.archiveRootEntry);
		const kit = KitDatabase.openSync(dbPath, schema, {
			encryption: { passphrase: manifest.passphrase }
		});
		try {
			// App migrations may have advanced past the fixture's generation era;
			// applying them is part of the upgrade path under test.
			kit.migrateSync(schema, migrations);

			const tableNames = new Set(kit.tableNames());
			// Application tables only — kit-internal bookkeeping tables are not
			// always listed by tableNames().
			for (const required of ['settings', 'users', 'trips', 'segments']) {
				expect(tableNames.has(required), `missing table ${required}`).toBe(true);
			}

			const settingsRow = kit
				.selectFrom(settings)
				.where(eq(settings.id, 1n))
				.executeSync()[0];
			expect(settingsRow).toBeDefined();
			expect(settingsRow.instance_name).toBe(manifest.expected.settingsInstanceName);
			expect(settingsRow.setup_complete).toBe(true);

			const userRows = kit
				.selectFrom(users)
				.where(eq(users.email, manifest.expected.userEmail))
				.executeSync();
			expect(userRows).toHaveLength(1);
			expect(userRows[0].display_name).toBe(manifest.expected.userDisplayName);
			expect(userRows[0].role).toBe('admin');

			// `name` shadows TableSpec keys — use column() for the SQL column.
			const tripRows = kit
				.selectFrom(trips)
				.where(eq(trips.column('name'), manifest.expected.tripName))
				.executeSync();
			expect(tripRows).toHaveLength(1);
			expect(tripRows[0].destination).toBe(manifest.expected.tripDestination);
			expect(tripRows[0].owner_id).toBe(userRows[0].id);

			const segmentRows = kit
				.selectFrom(segments)
				.where(eq(segments.trip_id, tripRows[0].id))
				.executeSync();
			expect(segmentRows).toHaveLength(1);
			expect(segmentRows[0].title).toBe(manifest.expected.segmentTitle);
			expect(segmentRows[0].type).toBe(manifest.expected.segmentType);
			expect(segmentRows[0].confirmation_number).toBe('COMPAT1');
		} finally {
			kit.close();
		}
	});

	test('fixture remains writable after open + migrate under current packages', async () => {
		const manifest = loadManifest();
		const extractRoot = mkdtempSync(join(tmpdir(), 'roamarr-compat-write-'));
		cleanupDirs.push(extractRoot);

		const dbPath = await extractFixture(extractRoot, manifest.archiveRootEntry);
		const kit = KitDatabase.openSync(dbPath, schema, {
			encryption: { passphrase: manifest.passphrase }
		});
		try {
			kit.migrateSync(schema, migrations);

			const user = kit
				.selectFrom(users)
				.where(eq(users.email, manifest.expected.userEmail))
				.executeSync()[0];
			expect(user).toBeDefined();

			const inserted = kit
				.insertInto(trips)
				.values({
					owner_id: user.id,
					name: 'Post-upgrade probe trip',
					destination: 'OPO',
					start_date: '2031-01-01',
					end_date: '2031-01-05',
					tags: '[]',
					archived: false,
					favorite: false,
					default_visibility: 'private',
					base_currency: 'EUR',
					status: 'planning'
				})
				.executeSync();

			const reread = kit
				.selectFrom(trips)
				.where(eq(trips.id, inserted.id))
				.executeSync()[0];
			expect(reread?.name).toBe('Post-upgrade probe trip');
			expect(reread?.owner_id).toBe(user.id);

			kit.deleteFrom(trips).where(eq(trips.id, inserted.id)).executeSync();
			const gone = kit.selectFrom(trips).where(eq(trips.id, inserted.id)).executeSync();
			expect(gone).toHaveLength(0);

			// Golden rows must survive the write/delete probe.
			const canary = kit
				.selectFrom(trips)
				.where(eq(trips.column('name'), manifest.expected.tripName))
				.executeSync();
			expect(canary).toHaveLength(1);
		} finally {
			kit.close();
		}
	});

	test('native doctor accepts the fixture after open', async () => {
		const manifest = loadManifest();
		const extractRoot = mkdtempSync(join(tmpdir(), 'roamarr-compat-doctor-'));
		cleanupDirs.push(extractRoot);

		const dbPath = await extractFixture(extractRoot, manifest.archiveRootEntry);
		// Open via kit first so encryption is unlocked the same way production does.
		const kit = KitDatabase.openSync(dbPath, schema, {
			encryption: { passphrase: manifest.passphrase }
		});
		try {
			kit.migrateSync(schema, migrations);
			const report = JSON.parse(kit.nativeDb.doctor()) as {
				ok: boolean;
				quarantined?: unknown[];
			};
			expect(report.ok).toBe(true);
		} finally {
			kit.close();
		}
	});

	test('fixture generation metadata is present and engine is at least as new', () => {
		const manifest = loadManifest();
		const running = mongreldb.buildInfo();

		expect(manifest.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
		expect(running.engineVersion).toMatch(/^\d+\.\d+\.\d+/);

		// Soft signal: if someone regenerates the fixture on a newer engine, the
		// committed manifest documents that. Downgrades (running < fixture) are
		// unusual for this gate; warn via assertion only when versions are parseable.
		const parse = (v: string) => v.split('.').map((p) => Number.parseInt(p, 10));
		const [ra, rb, rc] = parse(running.engineVersion);
		const [fa, fb, fc] = parse(manifest.engineVersion);
		const runningTuple = [ra, rb, rc] as const;
		const fixtureTuple = [fa, fb, fc] as const;
		const cmp =
			runningTuple[0] - fixtureTuple[0] ||
			runningTuple[1] - fixtureTuple[1] ||
			runningTuple[2] - fixtureTuple[2];
		expect(
			cmp >= 0,
			`running engine ${running.engineVersion} is older than fixture ${manifest.engineVersion}; regenerate fixture only on upgrade, not downgrade`
		).toBe(true);

		// App migrations listed in the fixture must still be a prefix of (or equal
		// to) the migrations the current code will apply — never a superset that
		// current code cannot understand.
		const currentVersions = migrations.map((m) => m.version);
		for (const v of manifest.migrationVersions) {
			expect(currentVersions).toContain(v);
		}
	});
});
