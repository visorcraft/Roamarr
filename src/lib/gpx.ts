import type { Feature, FeatureCollection, LineString, MultiLineString, Point, Position } from 'geojson';

/**
 * Minimal GPX (GPS Exchange Format) → GeoJSON parser.
 *
 * Client-safe and dependency-free: it relies on the platform DOMParser
 * (browser, or jsdom in tests). DOMParser never fetches external entities or
 * DTDs, so XXE-style payloads cannot read local files or make network calls;
 * combined with the input size cap below, billion-laughs-style documents are
 * rejected or harmlessly fail to parse.
 */

/** Matches the attachment upload cap (10 MB); GPX text larger than this is rejected. */
export const GPX_MAX_BYTES = 10 * 1024 * 1024;

export interface GpxBounds {
	minLat: number;
	minLng: number;
	maxLat: number;
	maxLng: number;
}

export interface GpxStats {
	/** Track + route + waypoint points with valid coordinates. */
	points: number;
	/** Haversine distance along tracks and routes, in meters. */
	distanceM: number;
}

export interface GpxParseResult {
	geojson: FeatureCollection;
	bounds: GpxBounds | null;
	stats: GpxStats;
}

function haversineM(a: Position, b: Position): number {
	const rad = Math.PI / 180;
	const dLat = (b[1]! - a[1]!) * rad;
	const dLng = (b[0]! - a[0]!) * rad;
	const lat1 = a[1]! * rad;
	const lat2 = b[1]! * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Read a trkpt/rtept/wpt element as [lng, lat], or null when coords are missing/invalid. */
function readPoint(el: Element): Position | null {
	const latAttr = el.getAttribute('lat');
	const lngAttr = el.getAttribute('lon');
	if (latAttr == null || lngAttr == null) return null;
	const lat = Number(latAttr);
	const lng = Number(lngAttr);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return [lng, lat];
}

function childText(el: Element, localName: string): string | null {
	const child = el.getElementsByTagNameNS('*', localName)[0];
	const text = child?.textContent?.trim();
	return text ? text : null;
}

function childNumber(el: Element, localName: string): number | null {
	const text = childText(el, localName);
	if (text == null) return null;
	const n = Number(text);
	return Number.isFinite(n) ? n : null;
}

function lineDistanceM(coords: Position[]): number {
	let d = 0;
	for (let i = 1; i < coords.length; i++) d += haversineM(coords[i - 1]!, coords[i]!);
	return d;
}

export function parseGpx(text: string): GpxParseResult {
	if (typeof DOMParser === 'undefined') {
		throw new Error('GPX parsing requires a DOMParser (browser or jsdom environment)');
	}
	// JS string length <= UTF-8 byte length, so this also bounds the byte size.
	if (text.length > GPX_MAX_BYTES) {
		throw new Error('GPX file is too large (10 MB maximum)');
	}

	const doc = new DOMParser().parseFromString(text, 'application/xml');
	// Both browsers and jsdom report malformed XML via a parsererror document.
	if (
		doc.documentElement.localName === 'parsererror' ||
		doc.getElementsByTagName('parsererror').length > 0
	) {
		throw new Error('Invalid GPX: malformed XML');
	}
	if (doc.documentElement.localName !== 'gpx') {
		throw new Error('Invalid GPX: root element is not <gpx>');
	}

	const features: Feature[] = [];
	let points = 0;
	let distanceM = 0;
	let minLat = Infinity;
	let minLng = Infinity;
	let maxLat = -Infinity;
	let maxLng = -Infinity;

	function track(coords: Position[]) {
		points += coords.length;
		for (const [lng, lat] of coords) {
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
			if (lng < minLng) minLng = lng;
			if (lng > maxLng) maxLng = lng;
		}
	}

	// Tracks: each trkseg is one line; a multi-segment trk becomes a MultiLineString.
	for (const trk of Array.from(doc.getElementsByTagNameNS('*', 'trk'))) {
		const segments: Position[][] = [];
		for (const seg of Array.from(trk.getElementsByTagNameNS('*', 'trkseg'))) {
			const coords: Position[] = [];
			for (const pt of Array.from(seg.getElementsByTagNameNS('*', 'trkpt'))) {
				const c = readPoint(pt);
				if (c) coords.push(c);
			}
			if (coords.length > 0) segments.push(coords);
		}
		if (segments.length === 0) continue;
		const geometry: LineString | MultiLineString =
			segments.length === 1
				? { type: 'LineString', coordinates: segments[0]! }
				: { type: 'MultiLineString', coordinates: segments };
		for (const seg of segments) {
			track(seg);
			distanceM += lineDistanceM(seg);
		}
		features.push({
			type: 'Feature',
			geometry,
			properties: { kind: 'track', name: childText(trk, 'name') }
		});
	}

	// Routes: rtept children form one LineString per rte.
	for (const rte of Array.from(doc.getElementsByTagNameNS('*', 'rte'))) {
		const coords: Position[] = [];
		for (const pt of Array.from(rte.getElementsByTagNameNS('*', 'rtept'))) {
			const c = readPoint(pt);
			if (c) coords.push(c);
		}
		if (coords.length === 0) continue;
		track(coords);
		distanceM += lineDistanceM(coords);
		features.push({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: coords },
			properties: { kind: 'route', name: childText(rte, 'name') }
		});
	}

	// Waypoints become Point features (name/ele when present).
	for (const wpt of Array.from(doc.getElementsByTagNameNS('*', 'wpt'))) {
		const c = readPoint(wpt);
		if (!c) continue;
		track([c]);
		const geometry: Point = { type: 'Point', coordinates: c };
		features.push({
			type: 'Feature',
			geometry,
			properties: { kind: 'waypoint', name: childText(wpt, 'name'), ele: childNumber(wpt, 'ele') }
		});
	}

	return {
		geojson: { type: 'FeatureCollection', features },
		bounds: points > 0 ? { minLat, minLng, maxLat, maxLng } : null,
		stats: { points, distanceM }
	};
}
