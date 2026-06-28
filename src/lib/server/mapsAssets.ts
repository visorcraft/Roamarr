import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getDatabasePath } from './paths';

// NASA "Blue Marble: Next Generation" (topography + bathymetry), public domain.
// The 5400x2700 single file is ~2.5MB and decodes safely in the browser without any
// server-side image processing. Swap this URL for a higher-resolution equirectangular
// day map if you later add downscaling tooling; everything else stays the same.
export const MAP_TEXTURE_URL =
	'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg';

const TEXTURE_TIMEOUT_MS = 5 * 60 * 1000;

export function getMapsAssetDir(): string {
	// Lives beside the SQLite DB and attachments so it persists across container rebuilds.
	return path.join(path.dirname(getDatabasePath()), 'maps');
}

export function textureFilePath(): string {
	return path.join(getMapsAssetDir(), 'earth-day.jpg');
}

export function hasMapTexture(): boolean {
	return existsSync(textureFilePath());
}

export function mapTextureImportedAt(): string | null {
	try {
		return statSync(textureFilePath()).mtime.toISOString();
	} catch {
		return null;
	}
}

export async function importMapTexture(url = MAP_TEXTURE_URL): Promise<void> {
	const dir = getMapsAssetDir();
	await mkdir(dir, { recursive: true });
	const finalPath = textureFilePath();
	const tmpPath = `${finalPath}.tmp`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TEXTURE_TIMEOUT_MS);
	try {
		const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
		if (!res.ok) throw new Error(`Texture download failed: ${res.status} ${res.statusText}`);
		if (!res.body) throw new Error('Texture download returned no body');
		await pipeline(
			// Node/DOM ReadableStream types differ; cast is required (mirrors geonames.ts).
			Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream),
			createWriteStream(tmpPath)
		);
		await rename(tmpPath, finalPath);
	} catch (e) {
		await rm(tmpPath, { force: true });
		throw e;
	} finally {
		clearTimeout(timeout);
	}
}
