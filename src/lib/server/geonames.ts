import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';
import { eq } from 'drizzle-orm';
import { db, sqlite } from './db';
import { geonamesCities, settings } from './db/schema';
import { nowIso } from './tz';

export const GEONAMES_DOWNLOAD_URL = 'https://download.geonames.org/export/dump/cities1000.zip';

export interface GeonamesCityRow {
	geonameId: number;
	name: string;
	asciiName: string;
	countryCode: string;
	lat: number;
	lng: number;
	population: number | null;
	timezone: string | null;
}

export function parseCities1000Line(line: string): GeonamesCityRow | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) return null;
	const parts = trimmed.split('\t');
	if (parts.length < 5) return null;
	const geonameId = Number(parts[0]);
	const name = parts[1];
	const asciiName = parts[2];
	const countryCode = parts[8];
	const lat = Number(parts[4]);
	const lng = Number(parts[5]);
	const population = parts[14] ? Number(parts[14]) : null;
	const timezone = parts[17] || null;
	if (
		!Number.isFinite(geonameId) ||
		!name ||
		!asciiName ||
		!countryCode ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lng)
	) {
		return null;
	}
	return { geonameId, name, asciiName, countryCode, lat, lng, population, timezone };
}

const INSERT_BATCH_SIZE = 2000;

function insertBatch(batch: GeonamesCityRow[]) {
	if (batch.length === 0) return;
	db.insert(geonamesCities).values(batch).run();
}

export function bulkInsertCities(cities: GeonamesCityRow[]): number {
	if (cities.length === 0) return 0;
	db.delete(geonamesCities).run();
	sqlite.transaction(() => {
		for (let i = 0; i < cities.length; i += INSERT_BATCH_SIZE) {
			const batch = cities.slice(i, i + INSERT_BATCH_SIZE);
			insertBatch(batch);
		}
	})();
	return cities.length;
}

async function importCitiesFromTextFile(txtPath: string): Promise<{ imported: number }> {
	db.delete(geonamesCities).run();

	let imported = 0;
	const batch: GeonamesCityRow[] = [];
	const insertBatchTx = sqlite.transaction((rows: GeonamesCityRow[]) => insertBatch(rows));

	const rl = createInterface({
		input: createReadStream(txtPath),
		crlfDelay: Infinity
	});

	for await (const line of rl) {
		const city = parseCities1000Line(line);
		if (!city) continue;
		batch.push(city);
		if (batch.length >= INSERT_BATCH_SIZE) {
			insertBatchTx(batch);
			imported += batch.length;
			batch.length = 0;
		}
	}

	if (batch.length > 0) {
		insertBatchTx(batch);
		imported += batch.length;
	}

	return { imported };
}

async function importCitiesFromZipFile(zipPath: string): Promise<{ imported: number }> {
	const extractDir = await mkdtemp(path.join(tmpdir(), 'roamarr-geonames-extract-'));
	try {
		const directory = await unzipper.Open.file(zipPath);
		const entry = directory.files.find((f) => f.path === 'cities1000.txt');
		if (!entry) {
			throw new Error('cities1000.txt not found in archive');
		}

		const txtPath = path.join(extractDir, 'cities1000.txt');
		await pipeline(entry.stream(), createWriteStream(txtPath));
		return await importCitiesFromTextFile(txtPath);
	} finally {
		await rm(extractDir, { recursive: true, force: true });
	}
}

export async function importCitiesFromReadable(readable: Readable): Promise<{ imported: number }> {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'roamarr-geonames-'));
	try {
		const zipPath = path.join(tempDir, 'cities1000.zip');
		await pipeline(readable, createWriteStream(zipPath));
		return await importCitiesFromZipFile(zipPath);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

export async function importCitiesFromPath(zipPath: string): Promise<{ imported: number }> {
	return importCitiesFromZipFile(zipPath);
}

export async function importCitiesFromUrl(url = GEONAMES_DOWNLOAD_URL): Promise<{ imported: number }> {
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) throw new Error(`GeoNames download failed: ${res.status} ${res.statusText}`);
	if (!res.body) throw new Error('GeoNames download returned no body');
	const result = await importCitiesFromReadable(Readable.fromWeb(res.body as any));
	db.update(settings)
		.set({ mapsEnabled: true, mapsGeonamesImportedAt: nowIso() })
		.where(eq(settings.id, 1))
		.run();
	return result;
}
