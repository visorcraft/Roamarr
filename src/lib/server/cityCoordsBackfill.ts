import { findCity } from './cities';
import { countCities } from './repositories/travelDataRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import * as tripsRepo from './repositories/tripsRepo';
import { kit } from './db';
import { segments, trips } from './db/mongrelSchema';
import { nowIso } from './tz';

export interface CityCoordsBackfillResult {
	/** Segments that received lat/lng from GeoNames. */
	segmentsUpdated: number;
	/** Trips that received destination lat/lng from GeoNames. */
	tripsUpdated: number;
	/** Rows with country+city that could not be matched in GeoNames. */
	unresolved: number;
	/** True when the GeoNames city table is empty (nothing to resolve against). */
	cityDatabaseEmpty: boolean;
}

/**
 * Fill missing lat/lng on segments and trips that already have a country code +
 * city name by looking up exact GeoNames matches. Safe to re-run (idempotent
 * for rows that already have both coordinates).
 *
 * Does not require maps to be enabled — only that the city database has rows.
 */
export function backfillMissingCityCoordinates(): CityCoordsBackfillResult {
	const cityDatabaseEmpty = countCities() === 0;
	if (cityDatabaseEmpty) {
		return { segmentsUpdated: 0, tripsUpdated: 0, unresolved: 0, cityDatabaseEmpty: true };
	}

	let segmentsUpdated = 0;
	let tripsUpdated = 0;
	let unresolved = 0;

	const allSegments = kit.selectFrom(segments).executeSync();
	for (const row of allSegments) {
		const country = row.country_code?.trim();
		const name = row.city_name?.trim();
		if (!country || !name) continue;
		if (row.city_lat != null && row.city_lng != null) continue;

		// Prefer stored admin1 so e.g. Dallas+GA does not become Dallas TX.
		const admin1 = row.admin1_code?.trim() || null;
		const city = findCity(country, name, admin1);
		if (!city) {
			unresolved++;
			continue;
		}
		segmentsRepo.updateSegment(Number(row.id), {
			city_name: city.name,
			city_lat: city.lat,
			city_lng: city.lng,
			admin1_code: admin1 ?? city.admin1Code ?? null,
			updated_at: nowIso()
		});
		segmentsUpdated++;
	}

	const allTrips = kit.selectFrom(trips).executeSync();
	for (const row of allTrips) {
		const country = row.destination_country_code?.trim();
		const name = row.destination_city_name?.trim();
		if (!country || !name) continue;
		if (row.destination_city_lat != null && row.destination_city_lng != null) continue;

		const admin1 = row.destination_admin1_code?.trim() || null;
		const city = findCity(country, name, admin1);
		if (!city) {
			unresolved++;
			continue;
		}
		tripsRepo.updateTrip(Number(row.id), {
			destinationCityName: city.name,
			destinationCityLat: city.lat,
			destinationCityLng: city.lng,
			destinationAdmin1Code: admin1 ?? city.admin1Code ?? null,
			updatedAt: nowIso()
		});
		tripsUpdated++;
	}

	return { segmentsUpdated, tripsUpdated, unresolved, cityDatabaseEmpty: false };
}
