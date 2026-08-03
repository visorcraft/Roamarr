// Geo import: parse external saved-place formats (Google Takeout "Saved" CSV,
// KML, KMZ, GeoJSON, pasted Google Maps links) into normalized candidates,
// flag duplicates against the user's places library, and batch-create places.
//
// Deviation from the original plan: resolving shared Google Maps list URLs
// server-side means fetching and parsing Google's obfuscated page JS, which
// is too fragile to ship. Instead the import accepts a pasted list of Google
// Maps place links (one per line), parsed locally without any network access.
// Short maps.app.goo.gl links carry no coordinates; they still import as a
// named row with a source link.

import { error } from '@sveltejs/kit';
import unzipper from 'unzipper';
import { createPlace, listPlaces, listPlaceCategories, type Place } from '$lib/server/places';
import { createPlaceLink } from '$lib/server/placeLinks';
import { logAudit } from '$lib/server/audit';

export const GEO_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const GEO_IMPORT_MAX_ROWS = 10_000;
const KMZ_MAX_ENTRIES = 100;
/** Coords within this distance of an existing place count as duplicates. */
const DUPLICATE_RADIUS_M = 50;

export interface GeoImportCandidate {
	name: string;
	lat: number | null;
	lng: number | null;
	address?: string | null;
	description?: string | null;
	sourceUrl?: string | null;
	categoryGuess?: string | null;
}

export interface GeoImportRow extends GeoImportCandidate {
	index: number;
	duplicate: boolean;
	duplicateReason: string | null;
	warnings: string[];
}

export interface GeoImportParseResult {
	format: 'takeout-csv' | 'kml' | 'kmz' | 'geojson' | 'url-list';
	candidates: GeoImportCandidate[];
	warnings: string[];
}

export interface GeoImportResult {
	created: number;
	skippedDuplicates: number;
	errors: { index: number; name: string; message: string }[];
	createdIds: number[];
}

// ============================================================================
// Format detection
// ============================================================================

function detectFormat(fileName: string, text: string, buffer: Buffer): GeoImportParseResult['format'] {
	const ext = fileName.toLowerCase().split('.').pop() ?? '';
	if (ext === 'kmz' || (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b)) return 'kmz';
	if (ext === 'kml') return 'kml';
	if (ext === 'geojson' || ext === 'json') return 'geojson';
	if (ext === 'txt') return 'url-list';
	if (ext === 'csv') return 'takeout-csv';
	// Content sniffing for extensionless or mislabeled uploads.
	const head = text.trimStart().slice(0, 200).toLowerCase();
	if (head.startsWith('{')) return 'geojson';
	if (head.startsWith('<?xml') || head.startsWith('<kml')) return 'kml';
	if (/^https?:\/\//m.test(text.trim())) return 'url-list';
	return 'takeout-csv';
}

// ============================================================================
// Coordinates in Google Maps URLs
// ============================================================================

function parseCoordPair(raw: string): { lat: number; lng: number } | null {
	const m = raw.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
	if (!m) return null;
	const lat = Number(m[1]);
	const lng = Number(m[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return { lat, lng };
}

/** Extract coordinates from a Google Maps URL (`!3d..!4d..`, `/@lat,lng`, `?q=`/`query=`/`ll=`). */
export function coordsFromMapsUrl(url: string): { lat: number; lng: number } | null {
	const bang = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
	if (bang) return parseCoordPair(`${bang[1]},${bang[2]}`);
	const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
	if (at) return parseCoordPair(`${at[1]},${at[2]}`);
	try {
		const u = new URL(url);
		for (const key of ['q', 'query', 'll']) {
			const v = u.searchParams.get(key);
			if (v) {
				const pair = parseCoordPair(v);
				if (pair) return pair;
			}
		}
	} catch {
		// Not a parseable URL; no coords.
	}
	return null;
}

/** Derive a display name from a Google Maps `/place/<slug>/` URL. */
function nameFromMapsUrl(url: string): string | null {
	const m = url.match(/\/place\/([^/@?]+)/);
	if (!m) return null;
	try {
		const decoded = decodeURIComponent(m[1]!).replace(/\+/g, ' ').trim();
		return decoded || null;
	} catch {
		return null;
	}
}

// ============================================================================
// CSV (Google Takeout "Saved": Title,Note,URL,Comment)
// ============================================================================

// Quote-aware single-line CSV split (same shape as the trips CSV importer).
function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i]!;
		const next = line[i + 1];
		if (inQuotes) {
			if (c === '"') {
				if (next === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			result.push(current);
			current = '';
		} else {
			current += c;
		}
	}
	result.push(current);
	return result;
}

function parseTakeoutCsv(text: string): GeoImportParseResult {
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length < 2) {
		throw error(400, 'CSV must have a header row and at least one data row');
	}
	const headers = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
	const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
	const titleIdx = idx(['title', 'name']);
	const noteIdx = idx(['note']);
	const urlIdx = idx(['url', 'link']);
	const commentIdx = idx(['comment']);
	if (titleIdx < 0) {
		throw error(400, 'CSV must have a Title column (Google Takeout "Saved" export)');
	}

	const candidates: GeoImportCandidate[] = [];
	const warnings: string[] = [];
	for (let i = 1; i < lines.length; i++) {
		const row = parseCsvLine(lines[i]!);
		const name = (titleIdx >= 0 ? row[titleIdx] : '')?.trim() ?? '';
		const note = noteIdx >= 0 ? row[noteIdx]?.trim() : '';
		const comment = commentIdx >= 0 ? row[commentIdx]?.trim() : '';
		const url = urlIdx >= 0 ? row[urlIdx]?.trim() : '';
		if (!name) {
			warnings.push(`Row ${i + 1}: skipped — no title`);
			continue;
		}
		const coords = url ? coordsFromMapsUrl(url) : null;
		const description = [note, comment].filter(Boolean).join('\n') || null;
		candidates.push({
			name,
			lat: coords?.lat ?? null,
			lng: coords?.lng ?? null,
			address: null,
			description,
			sourceUrl: url && /^https?:\/\//i.test(url) ? url : null
		});
	}
	return { format: 'takeout-csv', candidates, warnings };
}

// ============================================================================
// KML (minimal tag scanner — no XML dependency on the server)
// ============================================================================

function decodeXmlEntities(s: string): string {
	return s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function tagText(block: string, tag: string): string | null {
	const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i');
	const m = block.match(re);
	if (!m) return null;
	const text = decodeXmlEntities(m[1]!).trim();
	return text || null;
}

function parseKml(text: string): GeoImportCandidate[] {
	const candidates: GeoImportCandidate[] = [];
	const placemarkRe = /<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi;
	let pm: RegExpExecArray | null;
	while ((pm = placemarkRe.exec(text))) {
		const block = pm[1]!;
		const name = tagText(block, 'name');
		if (!name) continue;
		const description = tagText(block, 'description');
		const address = tagText(block, 'address');
		const coordText = tagText(block, 'coordinates');
		let lat: number | null = null;
		let lng: number | null = null;
		if (coordText) {
			// KML coordinates are lng,lat[,alt] tuples; take the first.
			const first = coordText.trim().split(/\s+/)[0]!;
			const parts = first.split(',');
			const plng = Number(parts[0]);
			const plat = Number(parts[1]);
			if (Number.isFinite(plat) && Number.isFinite(plng) && plat >= -90 && plat <= 90 && plng >= -180 && plng <= 180) {
				lat = plat;
				lng = plng;
			}
		}
		candidates.push({ name, lat, lng, address, description, sourceUrl: null });
	}
	return candidates;
}

async function parseKmlOrKmz(
	format: 'kml' | 'kmz',
	text: string,
	buffer: Buffer
): Promise<GeoImportParseResult> {
	if (format === 'kml') {
		const candidates = parseKml(text);
		if (candidates.length === 0) throw error(400, 'No Placemark entries with a name found in the KML file');
		return { format, candidates, warnings: [] };
	}
	let directory;
	try {
		directory = await unzipper.Open.buffer(buffer);
	} catch {
		throw error(400, 'Could not read the KMZ archive (invalid ZIP file)');
	}
	if (directory.files.length > KMZ_MAX_ENTRIES) {
		throw error(400, `KMZ archives may contain at most ${KMZ_MAX_ENTRIES} entries`);
	}
	const entry = directory.files.find((f) => f.path.toLowerCase().endsWith('.kml'));
	if (!entry) throw error(400, 'No .kml file found inside the KMZ archive');
	const content = await entry.buffer();
	if (content.length > GEO_IMPORT_MAX_BYTES) {
		throw error(400, 'The KML inside the KMZ archive is too large');
	}
	const candidates = parseKml(content.toString('utf8'));
	if (candidates.length === 0) throw error(400, 'No Placemark entries with a name found inside the KMZ archive');
	return { format, candidates, warnings: [] };
}

// ============================================================================
// GeoJSON
// ============================================================================

function parseGeoJson(text: string): GeoImportParseResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw error(400, 'Invalid GeoJSON: not valid JSON');
	}
	const root = parsed as { type?: string; features?: unknown };
	if (root?.type !== 'FeatureCollection' || !Array.isArray(root.features)) {
		throw error(400, 'GeoJSON must be a FeatureCollection');
	}
	const candidates: GeoImportCandidate[] = [];
	const warnings: string[] = [];
	root.features.forEach((feature, i) => {
		const f = feature as {
			type?: string;
			geometry?: { type?: string; coordinates?: unknown };
			properties?: Record<string, unknown> | null;
		};
		if (f?.type !== 'Feature') return;
		if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) {
			warnings.push(`Feature ${i + 1}: skipped — only Point geometries are importable`);
			return;
		}
		const [lngRaw, latRaw] = f.geometry.coordinates as unknown[];
		const lng = Number(lngRaw);
		const lat = Number(latRaw);
		if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
			warnings.push(`Feature ${i + 1}: skipped — invalid coordinates`);
			return;
		}
		const props = f.properties ?? {};
		const name =
			(typeof props.name === 'string' && props.name.trim()) ||
			(typeof props.title === 'string' && props.title.trim()) ||
			'';
		if (!name) {
			warnings.push(`Feature ${i + 1}: skipped — no name/title property`);
			return;
		}
		candidates.push({
			name,
			lat,
			lng,
			address: typeof props.address === 'string' ? props.address : null,
			description: typeof props.description === 'string' ? props.description : null,
			categoryGuess: typeof props.category === 'string' ? props.category : null,
			sourceUrl: null
		});
	});
	if (candidates.length === 0 && warnings.length === 0) {
		throw error(400, 'The GeoJSON FeatureCollection has no features');
	}
	return { format: 'geojson', candidates, warnings };
}

// ============================================================================
// Pasted Google Maps links (one per line)
// ============================================================================

export function parseMapsUrlList(text: string): GeoImportParseResult {
	const candidates: GeoImportCandidate[] = [];
	const warnings: string[] = [];
	const lines = text.split(/\r?\n/);
	lines.forEach((line, i) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		if (!/^https?:\/\//i.test(trimmed)) {
			warnings.push(`Line ${i + 1}: skipped — not an http(s) URL`);
			return;
		}
		const coords = coordsFromMapsUrl(trimmed);
		const name = nameFromMapsUrl(trimmed) ?? coordsToLabel(coords) ?? hostLabel(trimmed);
		if (!name) {
			warnings.push(`Line ${i + 1}: skipped — could not derive a name from the URL`);
			return;
		}
		candidates.push({
			name,
			lat: coords?.lat ?? null,
			lng: coords?.lng ?? null,
			address: null,
			description: null,
			sourceUrl: trimmed
		});
	});
	if (candidates.length === 0) {
		throw error(400, 'No usable Google Maps links found — paste one http(s) link per line');
	}
	return { format: 'url-list', candidates, warnings };
}

function coordsToLabel(coords: { lat: number; lng: number } | null): string | null {
	if (!coords) return null;
	return `Dropped pin (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
}

function hostLabel(url: string): string | null {
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

// ============================================================================
// Pipeline
// ============================================================================

/** Parse an uploaded file into normalized candidates. Enforces size and row caps. */
export async function parseGeoImport(fileName: string, buffer: Buffer): Promise<GeoImportParseResult> {
	if (buffer.length > GEO_IMPORT_MAX_BYTES) {
		throw error(400, 'Import file must be 20 MB or smaller');
	}
	if (buffer.length === 0) {
		throw error(400, 'The file is empty');
	}
	const text = buffer.toString('utf8');
	const format = detectFormat(fileName, text, buffer);
	const result =
		format === 'kml' || format === 'kmz'
			? await parseKmlOrKmz(format, text, buffer)
			: format === 'geojson'
				? parseGeoJson(text)
				: format === 'url-list'
					? parseMapsUrlList(text)
					: parseTakeoutCsv(text);
	if (result.candidates.length > GEO_IMPORT_MAX_ROWS) {
		throw error(400, `Imports are limited to ${GEO_IMPORT_MAX_ROWS.toLocaleString()} rows per file`);
	}
	return result;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLng = (lng2 - lng1) * rad;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

function coordsClose(
	a: { lat: number | null; lng: number | null },
	b: { lat: number | null; lng: number | null }
): boolean {
	if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
	return haversineM(a.lat, a.lng, b.lat, b.lng) <= DUPLICATE_RADIUS_M;
}

/** Flag candidates that duplicate an existing place or an earlier candidate in the same batch. */
export function previewGeoImport(userId: number, candidates: GeoImportCandidate[]): GeoImportRow[] {
	const existing = listPlaces(userId);
	const rows: GeoImportRow[] = candidates.map((c, index) => ({
		...c,
		index,
		duplicate: false,
		duplicateReason: null,
		warnings: c.lat == null ? ['No coordinates — imports without a map position'] : []
	}));

	for (const row of rows) {
		const match = existing.find(
			(p: Place) => normalizeName(p.name) === normalizeName(row.name) || coordsClose(row, p)
		);
		if (match) {
			row.duplicate = true;
			row.duplicateReason =
				normalizeName(match.name) === normalizeName(row.name)
					? `Matches existing place "${match.name}"`
					: `Within ${DUPLICATE_RADIUS_M} m of existing place "${match.name}"`;
			continue;
		}
		const earlier = rows.find(
			(r) =>
				r.index < row.index &&
				!r.duplicate &&
				(normalizeName(r.name) === normalizeName(row.name) || coordsClose(r, row))
		);
		if (earlier) {
			row.duplicate = true;
			row.duplicateReason = `Duplicates row ${earlier.index + 1} ("${earlier.name}") in this import`;
		}
	}
	return rows;
}

function resolveCategoryId(
	userId: number,
	opts: { categoryId?: number | null },
	categoryGuess: string | null | undefined
): number | null {
	if (opts.categoryId != null) return opts.categoryId;
	if (!categoryGuess) return null;
	const match = listPlaceCategories(userId).find(
		(c) => normalizeName(c.name) === normalizeName(categoryGuess)
	);
	return match?.id ?? null;
}

/**
 * Batch-create places from candidate rows. Duplicate detection is recomputed
 * here (never trust caller-supplied flags); `skipDuplicates` drops flagged
 * rows, otherwise everything is created. Per-row failures are collected, not
 * fatal.
 */
export function executeGeoImport(
	userId: number,
	candidates: GeoImportCandidate[],
	opts: { categoryId?: number | null; skipDuplicates?: boolean } = {}
): GeoImportResult {
	if (candidates.length > GEO_IMPORT_MAX_ROWS) {
		throw error(400, `Imports are limited to ${GEO_IMPORT_MAX_ROWS.toLocaleString()} rows per call`);
	}
	const skipDuplicates = opts.skipDuplicates ?? true;
	const rows = previewGeoImport(userId, candidates);
	const result: GeoImportResult = { created: 0, skippedDuplicates: 0, errors: [], createdIds: [] };

	for (const row of rows) {
		if (row.duplicate && skipDuplicates) {
			result.skippedDuplicates++;
			continue;
		}
		try {
			const place = createPlace(userId, {
				name: row.name,
				categoryId: resolveCategoryId(userId, opts, row.categoryGuess),
				address: row.address ?? null,
				lat: row.lat,
				lng: row.lng,
				description: row.description ?? null
			});
			result.created++;
			result.createdIds.push(place.id);
			if (row.sourceUrl) {
				try {
					createPlaceLink(userId, place.id, { label: 'Source link', url: row.sourceUrl, notes: null });
				} catch {
					// A bad source URL never blocks the place itself.
				}
			}
		} catch (e) {
			const message =
				(e as { body?: { message?: string } })?.body?.message ??
				(e as Error)?.message ??
				'Unknown error';
			result.errors.push({ index: row.index, name: row.name, message });
		}
	}

	if (result.created > 0) {
		logAudit(userId, 'places_import', 'place', 0, {
			created: result.created,
			skippedDuplicates: result.skippedDuplicates,
			errors: result.errors.length
		});
	}
	return result;
}
