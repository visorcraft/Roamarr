#!/usr/bin/env node
/**
 * Generate the committed MongrelDB compatibility fixture used by
 * `src/lib/server/db/mongrelCompat.test.ts`.
 *
 * The fixture is a real on-disk encrypted database written by the *currently
 * installed* @visorcraft/mongreldb + kit packages, packed as tar.gz. The test
 * opens that archive with whatever packages CI has later, so engine/storage
 * layout regressions surface as open/migrate/read failures.
 *
 * Usage (from repo root):
 *   node --experimental-strip-types --import ./scripts/seed-alias-loader.mjs \
 *     scripts/generate-compat-fixture.mjs
 *
 * Or: npm run db:compat-fixture
 *
 * Encryption passphrase is the fixed Vitest secret from vitest.setup.ts so the
 * fixture opens in the unit-test environment without extra env plumbing.
 */
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import tar from 'tar-fs';
import mongreldb from '@visorcraft/mongreldb';
import { KitDatabase, eq } from '@visorcraft/mongreldb-kit';
import { schema, settings, users, trips, segments } from '../src/lib/server/db/mongrelSchema.ts';
import { migrations } from '../src/lib/server/db/mongrelMigrations/index.ts';

// Must match vitest.setup.ts — the test suite always sets this before import.
const FIXTURE_PASSPHRASE = 'dGVzdC1zZWNyZXQtMzJieXRlcy0wMTIzNDU2Nzg5YWI=';

const EXPECTED = {
	settingsInstanceName: 'Compat Fixture',
	userEmail: 'compat-fixture@example.com',
	userDisplayName: 'Compat Canary',
	tripName: 'Schema regression canary',
	tripDestination: 'LIS',
	segmentTitle: 'Canary flight UA1',
	segmentType: 'flight'
};

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(repoRoot, 'tests', 'fixtures', 'mongreldb');
const archivePath = join(outDir, 'sample-db.tar.gz');
const manifestPath = join(outDir, 'manifest.json');

function packageVersion(packageName) {
	const entryUrl = import.meta.resolve(packageName);
	let dir = dirname(fileURLToPath(entryUrl));
	for (let i = 0; i < 6; i++) {
		const packageJsonPath = join(dir, 'package.json');
		if (existsSync(packageJsonPath)) {
			const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
			if (pkg.name === packageName && typeof pkg.version === 'string') {
				return pkg.version;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

async function main() {
	process.env.ROAMARR_SECRET = FIXTURE_PASSPHRASE;

	const workRoot = mkdtempSync(join(tmpdir(), 'roamarr-compat-fixture-'));
	const dbDir = join(workRoot, 'db');
	mkdirSync(dbDir, { recursive: true });
	mkdirSync(outDir, { recursive: true });

	try {
		const kit = KitDatabase.createEncryptedSync(dbDir, schema, FIXTURE_PASSPHRASE);
		try {
			kit.migrateSync(schema, migrations);

			// Settings row id=1 is seeded by migration 0001; rebrand it so the
			// test can prove we are reading *this* fixture, not a fresh DB.
			kit
				.updateTable(settings)
				.set({ instance_name: EXPECTED.settingsInstanceName, setup_complete: true })
				.where(eq(settings.id, 1n))
				.executeSync();

			const user = kit
				.insertInto(users)
				.values({
					email: EXPECTED.userEmail,
					password_hash: 'compat-fixture-not-a-real-hash',
					display_name: EXPECTED.userDisplayName,
					role: 'admin',
					disabled: false,
					must_reset_password: false,
					timezone: 'UTC',
					calendar_token: 'compat-cal-token'
				})
				.executeSync();

			const trip = kit
				.insertInto(trips)
				.values({
					owner_id: user.id,
					name: EXPECTED.tripName,
					destination: EXPECTED.tripDestination,
					destination_country_code: 'PT',
					destination_city_name: 'Lisbon',
					start_date: '2030-06-01',
					end_date: '2030-06-10',
					notes: 'Golden row for MongrelDB engine/kit upgrade gates.',
					tags: '["compat","canary"]',
					archived: false,
					favorite: true,
					default_visibility: 'private',
					base_currency: 'EUR',
					status: 'planning'
				})
				.executeSync();

			kit
				.insertInto(segments)
				.values({
					trip_id: trip.id,
					type: EXPECTED.segmentType,
					title: EXPECTED.segmentTitle,
					start_at: '2030-06-01T10:00:00.000Z',
					start_tz: 'Europe/Lisbon',
					end_at: '2030-06-01T13:30:00.000Z',
					end_tz: 'Europe/Lisbon',
					status: 'planned',
					location: 'LIS',
					country_code: 'PT',
					city_name: 'Lisbon',
					confirmation_number: 'COMPAT1'
				})
				.executeSync();

			// Persist memtables so the packed on-disk tree is self-contained.
			kit.flush();
		} finally {
			kit.close();
		}

		const build = mongreldb.buildInfo();
		const enginePackageVersion = packageVersion('@visorcraft/mongreldb');
		const kitPackageVersion = packageVersion('@visorcraft/mongreldb-kit');

		// Pack so extract yields a top-level `db/` directory with CATALOG.
		// Skip live lock files; they are process-local and not part of the layout.
		await pipeline(
			tar.pack(workRoot, {
				entries: ['db'],
				ignore: (name) => name.endsWith('.lock') || name.endsWith('/.lock')
			}),
			createGzip(),
			createWriteStream(archivePath)
		);

		const manifest = {
			generatedAt: new Date().toISOString(),
			archive: 'sample-db.tar.gz',
			archiveRootEntry: 'db',
			passphrase: FIXTURE_PASSPHRASE,
			passphraseSource: 'vitest.setup.ts ROAMARR_SECRET (test-only)',
			enginePackageVersion,
			kitPackageVersion,
			artifactVersion: build.artifactVersion,
			engineVersion: build.engineVersion,
			queryVersion: build.queryVersion,
			mongreldbGitSha: build.mongreldbGitSha,
			migrationVersions: migrations.map((m) => m.version),
			expected: EXPECTED,
			notes: [
				'Refresh with `npm run db:compat-fixture` after intentional storage-layout',
				'or encryption-format changes that intentionally break older on-disk DBs.',
				'Do not refresh solely because app migrations advanced — the test applies',
				'current migrations on open and that is part of the gate.'
			]
		};
		writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');

		console.log(`Wrote ${archivePath}`);
		console.log(`Wrote ${manifestPath}`);
		console.log(
			`engine=${enginePackageVersion} kit=${kitPackageVersion} native=${build.engineVersion}`
		);
	} finally {
		rmSync(workRoot, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
