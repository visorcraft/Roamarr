/**
 * Google Maps directions URL builder (pure, shared client/server).
 *
 * Assembles `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…`
 * from an ordered list of points: the first point becomes the origin, the last
 * the destination, and up to MAX_WAYPOINTS middle points become waypoints
 * (Google Maps URL API caps waypoints at 9). Returns null when fewer than two
 * valid points are available.
 */

import type { GeoPoint } from './routeOptimize';

export const GOOGLE_MAPS_MAX_WAYPOINTS = 9;

function formatPoint(p: GeoPoint): string {
	return `${p.lat},${p.lng}`;
}

function isValidPoint(p: GeoPoint): boolean {
	return Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export function buildGoogleMapsDirectionsUrl(points: GeoPoint[]): string | null {
	const valid = points.filter(isValidPoint);
	if (valid.length < 2) return null;
	const origin = valid[0];
	const destination = valid[valid.length - 1];
	const waypoints = valid.slice(1, -1).slice(0, GOOGLE_MAPS_MAX_WAYPOINTS);
	const params = new URLSearchParams({
		api: '1',
		origin: formatPoint(origin),
		destination: formatPoint(destination)
	});
	if (waypoints.length > 0) {
		params.set('waypoints', waypoints.map(formatPoint).join('|'));
	}
	return `https://www.google.com/maps/dir/?${params.toString()}`;
}
