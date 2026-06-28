import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';
import { importCitiesBatch, type GeonamesCityRow } from './repositories/travelDataRepo';
import { updateSettings } from './settings';
import { nowIso } from './tz';

export type { GeonamesCityRow };
export const GEONAMES_DOWNLOAD_URL = 'https://download.geonames.org/export/dump/cities1000.zip';

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
	const populationRaw = parts[14];
	const population = populationRaw ? Number(populationRaw) : null;
	const timezone = parts[17] || null;
	if (
		!Number.isFinite(geonameId) ||
		!name ||
		!asciiName ||
		!countryCode ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lng) ||
		(population !== null && !Number.isFinite(population))
	) {
		return null;
	}
	return { geonameId, name, asciiName, countryCode, lat, lng, population, timezone };
}

export function bulkInsertCities(cities: GeonamesCityRow[]): number {
	return importCitiesBatch(cities);
}

async function importCitiesFromTextFile(txtPath: string): Promise<{ imported: number }> {
	const cities: GeonamesCityRow[] = [];
	const rl = createInterface({
		input: createReadStream(txtPath),
		crlfDelay: Infinity
	});

	try {
		for await (const line of rl) {
			const city = parseCities1000Line(line);
			if (city) cities.push(city);
		}
	} finally {
		rl.close();
	}

	return { imported: bulkInsertCities(cities) };
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

const IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

export async function importCitiesFromUrl(url = GEONAMES_DOWNLOAD_URL): Promise<{ imported: number }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
	try {
		const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
		if (!res.ok) throw new Error(`GeoNames download failed: ${res.status} ${res.statusText}`);
		if (!res.body) throw new Error('GeoNames download returned no body');
		const result = await importCitiesFromReadable(
			// Node/DOM ReadableStream types differ; cast is required.
			Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
		);
		updateSettings({ mapsEnabled: true, mapsGeonamesImportedAt: nowIso() });
		return result;
	} finally {
		clearTimeout(timeout);
	}
}
