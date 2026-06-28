import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { geonamesCities } from './db/schema';

export interface CityResult {
	geonameId: number;
	name: string;
	countryCode: string;
	lat: number;
	lng: number;
}

export interface GlobeCity {
	id: number;
	name: string;
	lat: number;
	lon: number;
	population: number | null;
	countryCode: string;
}

export function findCity(countryCode: string, name: string): CityResult | null {
	const row = db
		.select({
			geonameId: geonamesCities.geonameId,
			name: geonamesCities.name,
			countryCode: geonamesCities.countryCode,
			lat: geonamesCities.lat,
			lng: geonamesCities.lng
		})
		.from(geonamesCities)
		.where(and(eq(geonamesCities.countryCode, countryCode.toUpperCase()), eq(geonamesCities.name, name)))
		.get();
	return row ?? null;
}

export function searchCities(countryCode: string, query: string, limit = 20): CityResult[] {
	const q = query.trim();
	if (!q || q.length < 2) return [];
	const likePattern = `%${q}%`;
	return db
		.select({
			geonameId: geonamesCities.geonameId,
			name: geonamesCities.name,
			countryCode: geonamesCities.countryCode,
			lat: geonamesCities.lat,
			lng: geonamesCities.lng
		})
		.from(geonamesCities)
		.where(
			and(
				eq(geonamesCities.countryCode, countryCode.toUpperCase()),
				sql`${geonamesCities.name} LIKE ${likePattern}`
			)
		)
		.orderBy(sql`CASE WHEN ${geonamesCities.name} = ${q} THEN 0 ELSE 1 END, ${geonamesCities.population} DESC`)
		.limit(limit)
		.all();
}

const GLOBE_SELECT = {
	id: geonamesCities.geonameId,
	name: geonamesCities.name,
	lat: geonamesCities.lat,
	lon: geonamesCities.lng,
	population: geonamesCities.population,
	countryCode: geonamesCities.countryCode
};

// SQLite sorts NULLs last under DESC, so nameless/popless rows fall to the bottom.
export function citiesForGlobe(center?: { lat: number; lng: number } | null): GlobeCity[] {
	const global = db
		.select(GLOBE_SELECT)
		.from(geonamesCities)
		.orderBy(desc(geonamesCities.population))
		.limit(1000)
		.all();

	const byId = new Map<number, GlobeCity>();
	for (const c of global) byId.set(c.id, c);

	// Denser coverage around the focus point so the centered region isn't just megacities.
	// ponytail: plain lat/lng box, no antimeridian wrap; the global set covers the edge case.
	if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
		const dLat = 12;
		const dLng = 14;
		const regional = db
			.select(GLOBE_SELECT)
			.from(geonamesCities)
			.where(
				and(
					gte(geonamesCities.lat, center.lat - dLat),
					lte(geonamesCities.lat, center.lat + dLat),
					gte(geonamesCities.lng, center.lng - dLng),
					lte(geonamesCities.lng, center.lng + dLng)
				)
			)
			.orderBy(desc(geonamesCities.population))
			.limit(600)
			.all();
		for (const c of regional) byId.set(c.id, c);
	}

	return [...byId.values()];
}
