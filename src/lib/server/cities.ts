import * as repo from './repositories/travelDataRepo';
import { getMapSettings } from './settings';

export interface CityResult {
	geonameId: number;
	name: string;
	countryCode: string;
	admin1Code: string | null;
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

export interface Admin1Option {
	code: string;
	name: string;
}

/**
 * Resolve an exact city name within a country, optionally within an admin1
 * subdivision. Among identical names in scope, highest population wins.
 * Callers with dropdown lat/lng should use {@link resolveCitySelection}.
 */
export function findCity(
	countryCode: string,
	name: string,
	admin1Code?: string | null
): CityResult | null {
	const city = repo.findCityByCountryAndName(countryCode, name, admin1Code);
	if (!city) return null;
	return {
		geonameId: city.geonameId,
		name: city.name,
		countryCode: city.countryCode,
		admin1Code: city.admin1Code ?? null,
		lat: city.lat,
		lng: city.lng
	};
}

export interface ResolvedCitySelection {
	name: string;
	admin1Code: string | null;
	lat: number | null;
	lng: number | null;
}

/**
 * Validate a city selection and fill missing coordinates from GeoNames when maps
 * are enabled. Exact name matches resolve even without lat/lng. Dropdown lat/lng
 * are kept. When admin1 is set, matches are scoped to that subdivision.
 */
export function resolveCitySelection(
	countryCode: string,
	name: string,
	lat: number | null | undefined,
	lng: number | null | undefined,
	admin1Code?: string | null
): { ok: true; city: ResolvedCitySelection } | { ok: false; error: string } {
	const maps = getMapSettings();
	const admin1 = admin1Code?.trim() || null;
	if (!maps.mapsEnabled) {
		return {
			ok: true,
			city: {
				name,
				admin1Code: admin1,
				lat: lat ?? null,
				lng: lng ?? null
			}
		};
	}
	if (maps.cityCount === 0) {
		return {
			ok: false,
			error:
				'Please ask your Roamarr administrator to use “Re-import city database” under Configuration → Maps.'
		};
	}
	const city = findCity(countryCode, name, admin1);
	if (!city) {
		return {
			ok: false,
			error: admin1
				? 'Selected city was not found in the GeoNames database for that state/province'
				: 'Selected city was not found in the GeoNames database'
		};
	}
	const hasCoords = lat != null && lng != null;
	return {
		ok: true,
		city: {
			name: city.name,
			// Prefer explicit form admin1; otherwise keep the matched city's admin1.
			admin1Code: admin1 ?? city.admin1Code,
			lat: hasCoords ? lat! : city.lat,
			lng: hasCoords ? lng! : city.lng
		}
	};
}

export function citySelectionError(
	countryCode: string,
	name: string,
	lat: number | null | undefined,
	lng: number | null | undefined,
	admin1Code?: string | null
): string | null {
	const resolved = resolveCitySelection(countryCode, name, lat, lng, admin1Code);
	return resolved.ok ? null : resolved.error;
}

export function searchCities(
	countryCode: string,
	query: string,
	limit = 20,
	admin1Code?: string | null
): CityResult[] {
	return repo.searchCities(query, countryCode, limit, admin1Code).map((c) => ({
		geonameId: c.geonameId,
		name: c.name,
		countryCode: c.countryCode,
		admin1Code: c.admin1Code ?? null,
		lat: c.lat,
		lng: c.lng
	}));
}

export function listAdmin1Options(countryCode: string): Admin1Option[] {
	return repo.listAdmin1ForCountry(countryCode).map((r) => ({
		code: r.admin1Code,
		name: r.name
	}));
}

export function countryUsesAdmin1(countryCode: string): boolean {
	return repo.countryHasAdmin1(countryCode);
}

// NULLs sort last under DESC, so nameless/popless rows fall to the bottom.
export function citiesForGlobe(center?: { lat: number; lng: number } | null): GlobeCity[] {
	const global = repo.listTopCitiesByPopulation(1000).map((c) => ({
		id: c.geonameId,
		name: c.name,
		lat: c.lat,
		lon: c.lng,
		population: c.population,
		countryCode: c.countryCode
	}));

	const byId = new Map<number, GlobeCity>();
	for (const c of global) byId.set(c.id, c);

	// Denser coverage around the focus point so the centered region isn't just megacities.
	// ponytail: plain lat/lng box, no antimeridian wrap; the global set covers the edge case.
	if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
		const dLat = 12;
		const dLng = 14;
		const candidates = repo.listTopCitiesByPopulation(1000).filter(
			(c) =>
				c.lat >= center.lat - dLat &&
				c.lat <= center.lat + dLat &&
				c.lng >= center.lng - dLng &&
				c.lng <= center.lng + dLng
		);
		for (const c of candidates) {
			byId.set(c.geonameId, {
				id: c.geonameId,
				name: c.name,
				lat: c.lat,
				lon: c.lng,
				population: c.population,
				countryCode: c.countryCode
			});
		}
	}

	return [...byId.values()];
}
