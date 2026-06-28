import * as repo from './repositories/travelDataRepo';

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
	const city = repo.findCityByCountryAndName(countryCode, name);
	if (!city) return null;
	return {
		geonameId: city.geonameId,
		name: city.name,
		countryCode: city.countryCode,
		lat: city.lat,
		lng: city.lng
	};
}

export function searchCities(countryCode: string, query: string, limit = 20): CityResult[] {
	return repo.searchCities(query, countryCode, limit).map((c) => ({
		geonameId: c.geonameId,
		name: c.name,
		countryCode: c.countryCode,
		lat: c.lat,
		lng: c.lng
	}));
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
