import { US_STATE_BOUNDARIES } from './usStateBoundaries.generated';

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i]![0];
		const yi = ring[i]![1];
		const xj = ring[j]![0];
		const yj = ring[j]![1];

		const intersect =
			yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

function pointInPolygon(lat: number, lng: number, coordinates: number[][][]): boolean {
	const exterior = coordinates[0];
	if (!exterior || !pointInRing(lat, lng, exterior)) return false;
	for (let i = 1; i < coordinates.length; i++) {
		if (pointInRing(lat, lng, coordinates[i]!)) return false;
	}
	return true;
}

function pointInMultiPolygon(lat: number, lng: number, coordinates: number[][][][]): boolean {
	for (const polygon of coordinates) {
		if (pointInPolygon(lat, lng, polygon)) return true;
	}
	return false;
}

/**
 * Reverse-geocode a WGS84 lat/lng to a U.S. state ISO-3166-2 code (e.g. "CA")
 * using the bundled, simplified Natural Earth boundary data.
 * Returns null for points outside all 50 states + DC.
 */
export function lookupUsStateFromLatLng(lat: number, lng: number): string | null {
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	for (const entry of US_STATE_BOUNDARIES) {
		const geom = entry.geometry;
		if (geom.type === 'Polygon') {
			if (pointInPolygon(lat, lng, geom.coordinates as number[][][])) return entry.code;
		} else if (geom.type === 'MultiPolygon') {
			if (pointInMultiPolygon(lat, lng, geom.coordinates as number[][][][])) return entry.code;
		}
	}
	return null;
}
