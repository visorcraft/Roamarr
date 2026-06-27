import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { geonamesCities } from './db/schema';

export interface CityResult {
	geonameId: number;
	name: string;
	countryCode: string;
	lat: number;
	lng: number;
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
