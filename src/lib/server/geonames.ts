import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';
import {
	importAdmin1Batch,
	importCitiesBatch,
	ensureAdmin1LabelsFromCities,
	type GeonamesAdmin1Row,
	type GeonamesCityRow
} from './repositories/travelDataRepo';
import { updateSettings } from './settings';
import { nowIso } from './tz';

export type { GeonamesCityRow };
export const GEONAMES_DOWNLOAD_URL = 'https://download.geonames.org/export/dump/cities1000.zip';
export const GEONAMES_ADMIN1_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';
const IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

export function parseCities1000Line(line: string): GeonamesCityRow | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) return null;
	const parts = trimmed.split('\t');
	if (parts.length < 5) return null;
	const geonameId = Number(parts[0]);
	const name = parts[1];
	const asciiName = parts[2];
	const countryCode = parts[8];
	// admin1 code is field 10 (0-based index 10) in the GeoNames dump
	const admin1Code = (parts[10] ?? '').trim() || null;
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
	return { geonameId, name, asciiName, countryCode, admin1Code, lat, lng, population, timezone };
}

/** Parse admin1CodesASCII.txt lines: `US.TX\tTexas\tTexas\tgeonameId` */
export function parseAdmin1Line(line: string): GeonamesAdmin1Row | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('#')) return null;
	const parts = trimmed.split('\t');
	if (parts.length < 2) return null;
	const compound = parts[0]!;
	const dot = compound.indexOf('.');
	if (dot <= 0) return null;
	const countryCode = compound.slice(0, dot).toUpperCase();
	const admin1Code = compound.slice(dot + 1);
	const name = parts[1]!;
	const asciiName = parts[2] || name;
	if (!countryCode || !admin1Code || !name) return null;
	return { countryCode, admin1Code, name, asciiName };
}

export function bulkInsertCities(cities: GeonamesCityRow[]): number {
	const n = importCitiesBatch(cities);
	ensureAdmin1LabelsFromCities();
	return n;
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

async function importAdmin1FromText(text: string): Promise<number> {
	const rows: GeonamesAdmin1Row[] = [];
	for (const line of text.split(/\r?\n/)) {
		const row = parseAdmin1Line(line);
		if (row) rows.push(row);
	}
	return importAdmin1Batch(rows);
}

async function importAdmin1LabelsFromUrl(): Promise<number> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
	try {
		const res = await fetch(GEONAMES_ADMIN1_URL, { redirect: 'follow', signal: controller.signal });
		if (!res.ok) return 0;
		const text = await res.text();
		return await importAdmin1FromText(text);
	} catch {
		return 0;
	} finally {
		clearTimeout(timeout);
	}
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
		const result = await importCitiesFromZipFile(zipPath);
		// Best-effort labels (network may be unavailable for offline zip upload)
		await importAdmin1LabelsFromUrl();
		ensureAdmin1LabelsFromCities();
		return result;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

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
