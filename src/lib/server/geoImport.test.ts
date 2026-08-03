import { test, expect, vi, beforeEach } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	parseGeoImport,
	parseMapsUrlList,
	previewGeoImport,
	executeGeoImport,
	coordsFromMapsUrl,
	GEO_IMPORT_MAX_ROWS
} from '$lib/server/geoImport';
import { createPlace, listPlaces, createPlaceCategory } from '$lib/server/places';
import { places, placeCategories, placeLinks, auditLogs, users } from '$lib/server/db/mongrelSchema';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeUser } from '../../../tests/helpers';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

let userId: number;

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(placeLinks).executeSync();
	kit.deleteFrom(places).executeSync();
	kit.deleteFrom(placeCategories).executeSync();
	kit.deleteFrom(auditLogs).executeSync();
	kit.deleteFrom(users).executeSync();
	userId = makeUser(kit).id;
});

/** Minimal ZIP writer (single deflated entry) for KMZ fixtures. */
function buildZip(entryName: string, content: string): Buffer {
	const nameBytes = Buffer.from(entryName, 'utf8');
	const data = Buffer.from(content, 'utf8');
	const compressed = deflateRawSync(data);
	const crc = crc32(data);

	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4); // version needed
	local.writeUInt16LE(0, 6); // flags
	local.writeUInt16LE(8, 8); // deflate
	local.writeUInt16LE(0, 10); // time
	local.writeUInt16LE(0, 12); // date
	local.writeUInt32LE(Number(crc), 14);
	local.writeUInt32LE(compressed.length, 18);
	local.writeUInt32LE(data.length, 22);
	local.writeUInt16LE(nameBytes.length, 26);
	local.writeUInt16LE(0, 28); // extra len

	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4); // version made by
	central.writeUInt16LE(20, 6); // version needed
	central.writeUInt16LE(0, 8); // flags
	central.writeUInt16LE(8, 10); // deflate
	central.writeUInt16LE(0, 12); // time
	central.writeUInt16LE(0, 14); // date
	central.writeUInt32LE(Number(crc), 16);
	central.writeUInt32LE(compressed.length, 20);
	central.writeUInt32LE(data.length, 24);
	central.writeUInt16LE(nameBytes.length, 28);
	// extra/comment/disk/attrs all zero (30..41)
	central.writeUInt32LE(0, 42); // local header offset

	const cdOffset = local.length + nameBytes.length + compressed.length;
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8); // entries on this disk
	eocd.writeUInt16LE(1, 10); // total entries
	eocd.writeUInt32LE(central.length + nameBytes.length, 12);
	eocd.writeUInt32LE(cdOffset, 16);

	return Buffer.concat([local, nameBytes, compressed, central, nameBytes, eocd]);
}

// ============================================================================
// Coordinate extraction from Google Maps URLs
// ============================================================================

test('coordsFromMapsUrl handles !3d/!4d, @lat,lng, and ?q= forms', () => {
	expect(
		coordsFromMapsUrl('https://www.google.com/maps/place/X/data=!3m1!4b1!4m2!3m1!1s0x0:0x0!3d48.8583!4d2.2945')
	).toEqual({ lat: 48.8583, lng: 2.2945 });
	expect(coordsFromMapsUrl('https://www.google.com/maps/@41.9028,12.4964,15z')).toEqual({
		lat: 41.9028,
		lng: 12.4964
	});
	expect(coordsFromMapsUrl('https://maps.google.com/?q=35.6812,139.7671')).toEqual({
		lat: 35.6812,
		lng: 139.7671
	});
	expect(coordsFromMapsUrl('https://maps.app.goo.gl/abc123')).toBeNull();
	expect(coordsFromMapsUrl('not a url')).toBeNull();
});

// ============================================================================
// Google Takeout CSV
// ============================================================================

test('parses a Takeout Saved CSV with quoted fields and coords in the URL', async () => {
	const csv = [
		'Title,Note,URL,Comment',
		'"Eiffel Tower","Iconic, tall","https://www.google.com/maps/place/Eiffel+Tower/data=!3d48.8583!4d2.2945","go at sunset"',
		'"Colosseum",,"https://www.google.com/maps/@41.8902,12.4922,17z",',
		'"No Coords Place","only a note","https://maps.app.goo.gl/xyz",'
	].join('\n');
	const result = await parseGeoImport('Saved.csv', Buffer.from(csv));
	expect(result.format).toBe('takeout-csv');
	expect(result.candidates).toHaveLength(3);
	expect(result.candidates[0]).toMatchObject({
		name: 'Eiffel Tower',
		lat: 48.8583,
		lng: 2.2945,
		description: 'Iconic, tall\ngo at sunset'
	});
	expect(result.candidates[1]).toMatchObject({ name: 'Colosseum', lat: 41.8902, lng: 12.4922 });
	// Rows without coords are still importable.
	expect(result.candidates[2]).toMatchObject({ name: 'No Coords Place', lat: null, lng: null });
	expect(result.candidates[2]!.sourceUrl).toBe('https://maps.app.goo.gl/xyz');
});

test('Takeout CSV tolerates missing optional columns and nameless rows', async () => {
	const csv = ['Title,URL', '"Solo",https://www.google.com/maps/@10,20,12z', ',https://x.example'].join(
		'\n'
	);
	const result = await parseGeoImport('saved.csv', Buffer.from(csv));
	expect(result.candidates).toHaveLength(1);
	expect(result.warnings).toHaveLength(1);
	expect(result.warnings[0]).toContain('no title');
});

test('Takeout CSV without a Title column is rejected', async () => {
	await expect(parseGeoImport('x.csv', Buffer.from('A,B\n1,2'))).rejects.toMatchObject({
		status: 400
	});
});

// ============================================================================
// KML / KMZ
// ============================================================================

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Shibuya Crossing</name>
      <description><![CDATA[Busy <b>scramble</b> & lights]]></description>
      <address>Shibuya, Tokyo</address>
      <Point><coordinates>139.7005,35.6595,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Mount Fuji</name>
      <Point><coordinates>138.7274,35.3606</coordinates></Point>
    </Placemark>
    <Placemark><Point><coordinates>1,2</coordinates></Point></Placemark>
  </Document>
</kml>`;

test('parses KML placemarks with CDATA and lng,lat[,alt] coordinates', async () => {
	const result = await parseGeoImport('places.kml', Buffer.from(KML));
	expect(result.format).toBe('kml');
	expect(result.candidates).toHaveLength(2);
	expect(result.candidates[0]).toMatchObject({
		name: 'Shibuya Crossing',
		lat: 35.6595,
		lng: 139.7005,
		address: 'Shibuya, Tokyo',
		description: 'Busy <b>scramble</b> & lights'
	});
	expect(result.candidates[1]).toMatchObject({ name: 'Mount Fuji', lat: 35.3606, lng: 138.7274 });
});

test('parses KMZ archives (zipped KML)', async () => {
	const kmz = buildZip('doc.kml', KML);
	const result = await parseGeoImport('places.kmz', kmz);
	expect(result.format).toBe('kmz');
	expect(result.candidates).toHaveLength(2);
	expect(result.candidates[0]!.name).toBe('Shibuya Crossing');
});

test('rejects a KMZ with no KML entry and corrupt archives', async () => {
	const noKml = buildZip('readme.txt', 'hello');
	await expect(parseGeoImport('x.kmz', noKml)).rejects.toMatchObject({ status: 400 });
	await expect(parseGeoImport('x.kmz', Buffer.from('not a zip at all'))).rejects.toMatchObject({
		status: 400
	});
});

test('rejects KML without named placemarks', async () => {
	await expect(
		parseGeoImport('x.kml', Buffer.from('<?xml version="1.0"?><kml><Document/></kml>'))
	).rejects.toMatchObject({ status: 400 });
});

// ============================================================================
// GeoJSON
// ============================================================================

test('parses a GeoJSON FeatureCollection of points', async () => {
	const geojson = JSON.stringify({
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [2.2945, 48.8583] },
				properties: { name: 'Eiffel Tower', description: 'Iron lady', category: 'Culture' }
			},
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [12.4922, 41.8902] },
				properties: { title: 'Colosseo' }
			},
			{
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
				properties: { name: 'A line' }
			},
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [0, 0] },
				properties: {}
			}
		]
	});
	const result = await parseGeoImport('places.geojson', Buffer.from(geojson));
	expect(result.format).toBe('geojson');
	expect(result.candidates).toHaveLength(2);
	expect(result.candidates[0]).toMatchObject({
		name: 'Eiffel Tower',
		lat: 48.8583,
		lng: 2.2945,
		categoryGuess: 'Culture'
	});
	expect(result.candidates[1]).toMatchObject({ name: 'Colosseo', lat: 41.8902 });
	expect(result.warnings).toHaveLength(2);
});

test('rejects malformed GeoJSON and non-FeatureCollection JSON', async () => {
	await expect(parseGeoImport('x.geojson', Buffer.from('not json'))).rejects.toMatchObject({
		status: 400
	});
	await expect(
		parseGeoImport('x.geojson', Buffer.from('{"type":"Feature","geometry":null}'))
	).rejects.toMatchObject({ status: 400 });
});

// ============================================================================
// URL list
// ============================================================================

test('parses pasted Google Maps links, one per line', () => {
	const text = [
		'https://www.google.com/maps/place/Eiffel+Tower/@48.8583,2.2945,17z',
		'https://maps.app.goo.gl/shortlink',
		'not a url'
	].join('\n');
	const result = parseMapsUrlList(text);
	expect(result.candidates).toHaveLength(2);
	expect(result.candidates[0]).toMatchObject({ name: 'Eiffel Tower', lat: 48.8583, lng: 2.2945 });
	// Short links carry no coords and no name slug; still importable via hostname label.
	expect(result.candidates[1]).toMatchObject({
		name: 'maps.app.goo.gl',
		lat: null,
		sourceUrl: 'https://maps.app.goo.gl/shortlink'
	});
	expect(result.warnings).toHaveLength(1);
});

// ============================================================================
// Caps
// ============================================================================

test('enforces the 20 MB file cap', async () => {
	const big = Buffer.alloc(20 * 1024 * 1024 + 1, 0x61);
	await expect(parseGeoImport('big.csv', big)).rejects.toMatchObject({ status: 400 });
});

test('enforces the 10k row cap', async () => {
	const header = 'Title,URL\n';
	const row = '"Place",https://www.google.com/maps/@10,20,12z\n';
	const csv = header + row.repeat(GEO_IMPORT_MAX_ROWS + 1);
	await expect(parseGeoImport('many.csv', Buffer.from(csv))).rejects.toMatchObject({
		status: 400
	});
});

// ============================================================================
// Duplicate detection
// ============================================================================

test('preview flags duplicates by exact name and by 50 m proximity', () => {
	createPlace(userId, { name: 'Eiffel Tower', lat: 48.8583, lng: 2.2945 });
	createPlace(userId, { name: 'Far Away', lat: 0, lng: 0 });

	const rows = previewGeoImport(userId, [
		{ name: 'eiffel tower', lat: null, lng: null }, // name match (case-insensitive)
		{ name: 'Tour Eiffel', lat: 48.85835, lng: 2.29455 }, // ~7 m away
		{ name: 'Fresh Place', lat: 40.4168, lng: -3.7038 },
		{ name: 'Fresh Place', lat: 40.4168, lng: -3.7038 } // in-file duplicate
	]);
	expect(rows[0]!.duplicate).toBe(true);
	expect(rows[0]!.duplicateReason).toContain('Eiffel Tower');
	expect(rows[1]!.duplicate).toBe(true);
	expect(rows[1]!.duplicateReason).toContain('Within 50 m');
	expect(rows[2]!.duplicate).toBe(false);
	expect(rows[3]!.duplicate).toBe(true);
	expect(rows[3]!.duplicateReason).toContain('row 3');
});

test('preview does not match places owned by other users', () => {
	const otherId = makeUser(kitDb()).id;
	createPlace(otherId, { name: 'Their Place', lat: 48.8583, lng: 2.2945 });
	const rows = previewGeoImport(userId, [{ name: 'Their Place', lat: 48.8583, lng: 2.2945 }]);
	expect(rows[0]!.duplicate).toBe(false);
});

// ============================================================================
// Execute
// ============================================================================

test('executeGeoImport creates places, skips duplicates, and writes an audit row', () => {
	createPlace(userId, { name: 'Existing', lat: 48.8583, lng: 2.2945 });
	const result = executeGeoImport(
		userId,
		[
			{ name: 'Existing', lat: null, lng: null },
			{ name: 'Brand New', lat: 40.4168, lng: -3.7038, address: 'Madrid', sourceUrl: 'https://www.google.com/maps/@40.4168,-3.7038,15z' }
		],
		{ skipDuplicates: true }
	);
	expect(result.created).toBe(1);
	expect(result.skippedDuplicates).toBe(1);
	expect(result.errors).toHaveLength(0);

	const all = listPlaces(userId);
	expect(all).toHaveLength(2);
	const created = all.find((p) => p.name === 'Brand New')!;
	expect(created.lat).toBeCloseTo(40.4168);
	// The source URL became a place link.
	const links = kitDb()
		.selectFrom(placeLinks)
		.executeSync()
		.filter((l) => Number(l.place_id) === created.id);
	expect(links).toHaveLength(1);
	expect(links[0]!.url).toContain('google.com/maps');

	const logs = kitDb().selectFrom(auditLogs).executeSync();
	const importLog = logs.filter((l) => l.action === 'places_import');
	expect(importLog).toHaveLength(1);
});

test('executeGeoImport with skipDuplicates off imports duplicates too', () => {
	createPlace(userId, { name: 'Existing', lat: 48.8583, lng: 2.2945 });
	const result = executeGeoImport(userId, [{ name: 'Existing', lat: 1, lng: 1 }], {
		skipDuplicates: false
	});
	expect(result.created).toBe(1);
	expect(result.skippedDuplicates).toBe(0);
	expect(listPlaces(userId)).toHaveLength(2);
});

test('executeGeoImport applies a bulk category and resolves category guesses', () => {
	const cat = createPlaceCategory(userId, { name: 'Coffee', color: '#6f4e37' });
	const bulk = createPlaceCategory(userId, { name: 'Bulk', color: '#000000' });

	const guessed = executeGeoImport(userId, [{ name: 'Cafe A', lat: 1, lng: 1, categoryGuess: 'coffee' }]);
	const forced = executeGeoImport(
		userId,
		[{ name: 'Cafe B', lat: 2, lng: 2, categoryGuess: 'coffee' }],
		{ categoryId: bulk.id }
	);
	expect(guessed.created).toBe(1);
	expect(forced.created).toBe(1);
	const all = listPlaces(userId);
	expect(all.find((p) => p.name === 'Cafe A')!.categoryId).toBe(cat.id);
	expect(all.find((p) => p.name === 'Cafe B')!.categoryId).toBe(bulk.id);
});

test('executeGeoImport collects per-row errors without aborting the batch', () => {
	const result = executeGeoImport(userId, [
		{ name: 'Good', lat: 1, lng: 1 },
		{ name: 'Bad coords', lat: 200, lng: 1 } // invalid latitude
	]);
	expect(result.created).toBe(1);
	expect(result.errors).toHaveLength(1);
	expect(result.errors[0]!.name).toBe('Bad coords');
});
