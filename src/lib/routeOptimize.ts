/**
 * Pure route optimization for a small set of geo points (shared client/server).
 *
 * Algorithm: nearest-neighbor construction from an optional fixed start point
 * (falling back to the southernmost item), followed by a 2-opt improvement
 * pass over haversine distances. Fully deterministic: every tie is broken by
 * original input order, and the 2-opt scan always applies the first improving
 * swap found in a fixed iteration order (capped at MAX_SWAPS).
 */

export interface GeoPoint {
	lat: number;
	lng: number;
}

export interface RouteItem extends GeoPoint {
	id: number | string;
}

export interface RouteOptimization {
	orderedIds: (number | string)[];
	totalDistanceMeters: number;
}

const EARTH_RADIUS_METERS = 6371000;
const MAX_SWAPS = 1000;
// Epsilon so floating-point noise never counts as an "improvement".
const IMPROVEMENT_EPSILON = 1e-9;

/** Great-circle distance between two points in meters. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pathDistance(order: RouteItem[], start: GeoPoint | null): number {
	let total = 0;
	let prev: GeoPoint | null = start;
	for (const item of order) {
		if (prev) total += haversineMeters(prev, item);
		prev = item;
	}
	return total;
}

function nearestNeighborOrder(items: RouteItem[], start: GeoPoint | null): RouteItem[] {
	const remaining = items.slice();
	const order: RouteItem[] = [];
	let current: GeoPoint | null = start;
	if (!current) {
		// No fixed start: seed with the southernmost item (ties keep input order).
		let seedIndex = 0;
		for (let i = 1; i < remaining.length; i++) {
			if (remaining[i].lat < remaining[seedIndex].lat) seedIndex = i;
		}
		const seed = remaining.splice(seedIndex, 1)[0];
		order.push(seed);
		current = seed;
	}
	while (remaining.length > 0) {
		let bestIndex = 0;
		let bestDistance = haversineMeters(current, remaining[0]);
		for (let i = 1; i < remaining.length; i++) {
			const d = haversineMeters(current, remaining[i]);
			// Strictly-less keeps the earliest input item on ties.
			if (d < bestDistance - IMPROVEMENT_EPSILON) {
				bestDistance = d;
				bestIndex = i;
			}
		}
		const next = remaining.splice(bestIndex, 1)[0];
		order.push(next);
		current = next;
	}
	return order;
}

function twoOpt(order: RouteItem[], start: GeoPoint | null): RouteItem[] {
	const n = order.length;
	if (n < 3) return order;
	let best = order.slice();
	let bestDistance = pathDistance(best, start);
	let swaps = 0;
	let improved = true;
	while (improved && swaps < MAX_SWAPS) {
		improved = false;
		outer: for (let i = 0; i < n - 1; i++) {
			for (let j = i + 1; j < n; j++) {
				const candidate = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
				const candidateDistance = pathDistance(candidate, start);
				if (candidateDistance < bestDistance - IMPROVEMENT_EPSILON) {
					best = candidate;
					bestDistance = candidateDistance;
					swaps++;
					improved = true;
					if (swaps >= MAX_SWAPS) break outer;
					break outer; // first-improvement: restart the scan
				}
			}
		}
	}
	return best;
}

/**
 * Order the given coord-bearing items into a short open path.
 *
 * - `start` pins the beginning of the path (e.g. the day's lodging); it is
 *   included in the total distance but not in the output id list.
 * - Fewer than 3 items keep their input order (any order is equally short).
 */
export function optimizeRoute(items: RouteItem[], start: GeoPoint | null = null): RouteOptimization {
	if (items.length === 0) return { orderedIds: [], totalDistanceMeters: 0 };
	if (items.length < 3) {
		return { orderedIds: items.map((i) => i.id), totalDistanceMeters: pathDistance(items, start) };
	}
	const seeded = nearestNeighborOrder(items, start);
	const improved = twoOpt(seeded, start);
	return {
		orderedIds: improved.map((i) => i.id),
		totalDistanceMeters: pathDistance(improved, start)
	};
}
