import { eq, desc, type Row, type Insert } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { geonamesCities, geonamesAdmin1 } from '$lib/server/db/mongrelSchema';

// ============================================================================
// GeoNames cities
// ============================================================================

export interface GeonamesCityRow {
	geonameId: number;
	name: string;
	asciiName: string;
	alternateNames?: string | null;
	countryCode: string;
	/** GeoNames admin1 code within the country (e.g. TX, ON). */
	admin1Code?: string | null;
	lat: number;
	lng: number;
	population: number | null;
	timezone: string | null;
}

export interface GeonamesAdmin1Row {
	countryCode: string;
	admin1Code: string;
	name: string;
	asciiName: string | null;
}

function toGeonamesCityRow(row: Row<typeof geonamesCities>): GeonamesCityRow {
	return {
		geonameId: Number(row.geoname_id),
		name: row.name,
		asciiName: row.ascii_name,
		alternateNames: row.alternate_names ?? null,
		countryCode: row.country_code,
		admin1Code: row.admin1_code ?? null,
		lat: row.lat,
		lng: row.lng,
		population: row.population == null ? null : Number(row.population),
		timezone: row.timezone
	};
}

function toKitGeonamesCityInput(row: GeonamesCityRow): Insert<typeof geonamesCities> {
	return {
		geoname_id: BigInt(row.geonameId),
		name: row.name,
		ascii_name: row.asciiName,
		alternate_names: row.alternateNames ?? null,
		country_code: row.countryCode,
		admin1_code: row.admin1Code ?? null,
		lat: row.lat,
		lng: row.lng,
		population: row.population == null ? null : BigInt(row.population),
		timezone: row.timezone
	};
}

/**
 * MongrelDB Kit full-table reads page with `queryPage(limit, offset)`. The
 * native engine rejects `offset > 100000`, so unrestricted `deleteFrom` /
 * `selectFrom` on cities1000 (~170k rows) fails with
 * `InvalidArgument("query offset exceeds 100000")`. Prefer `truncateTable`
 * for full clears.
 */
const KIT_FULL_SCAN_OFFSET_CAP = 100_000;

export function importCitiesBatch(cities: GeonamesCityRow[]): number {
	// truncateTable is O(table) and does not page with offset (unlike deleteFrom).
	kit.truncateTable(geonamesCities.name);
	if (cities.length === 0) return 0;
	// One transaction for the whole batch — far faster than a row-at-a-time loop.
	kit
		.insertInto(geonamesCities)
		.valuesMany(cities.map((city) => toKitGeonamesCityInput(city) as Insert<typeof geonamesCities>))
		.executeSync();
	return cities.length;
}

export function importAdmin1Batch(rows: GeonamesAdmin1Row[]): number {
	kit.truncateTable(geonamesAdmin1.name);
	if (rows.length === 0) return 0;
	kit
		.insertInto(geonamesAdmin1)
		.valuesMany(
			rows.map(
				(r) =>
					({
						country_code: r.countryCode.toUpperCase(),
						admin1_code: r.admin1Code,
						name: r.name,
						ascii_name: r.asciiName
					}) as Insert<typeof geonamesAdmin1>
			)
		)
		.executeSync();
	return rows.length;
}

/** Ensure label rows exist for every admin1 present on cities (code-as-name fallback). */
export function ensureAdmin1LabelsFromCities(): number {
	const cityCount = Number(kit.selectFrom(geonamesCities).selectCount().executeSync());
	// Full select of cities1000 hits the queryPage offset cap. Prefer the
	// official admin1CodesASCII.txt import (importAdmin1Batch) for large DBs.
	if (cityCount >= KIT_FULL_SCAN_OFFSET_CAP) {
		return 0;
	}
	const cities = kit.selectFrom(geonamesCities).executeSync();
	const existing = new Set(
		kit
			.selectFrom(geonamesAdmin1)
			.executeSync()
			.map((r) => `${r.country_code}\0${r.admin1_code}`)
	);
	const toAdd: Insert<typeof geonamesAdmin1>[] = [];
	const seen = new Set<string>();
	for (const c of cities) {
		const code = c.admin1_code?.trim();
		if (!code) continue;
		const key = `${c.country_code}\0${code}`;
		if (existing.has(key) || seen.has(key)) continue;
		seen.add(key);
		toAdd.push({
			country_code: c.country_code,
			admin1_code: code,
			name: code,
			ascii_name: code
		});
	}
	if (toAdd.length === 0) return 0;
	kit.insertInto(geonamesAdmin1).valuesMany(toAdd).executeSync();
	return toAdd.length;
}

export function listAdmin1ForCountry(countryCode: string): GeonamesAdmin1Row[] {
	const code = countryCode.toUpperCase();
	const labeled = kit
		.selectFrom(geonamesAdmin1)
		.where(eq(geonamesAdmin1.country_code, code))
		.executeSync()
		.map((r) => ({
			countryCode: r.country_code,
			admin1Code: r.admin1_code,
			name: r.name,
			asciiName: r.ascii_name
		}));
	if (labeled.length > 0) {
		return labeled.sort((a, b) => a.name.localeCompare(b.name));
	}
	// Fallback: unique codes from cities when labels not imported yet
	const codes = new Set<string>();
	for (const c of kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.country_code, code))
		.executeSync()) {
		if (c.admin1_code?.trim()) codes.add(c.admin1_code.trim());
	}
	return [...codes]
		.sort()
		.map((admin1Code) => ({
			countryCode: code,
			admin1Code,
			name: admin1Code,
			asciiName: admin1Code
		}));
}

/** True when this country has at least one admin1 subdivision in the city DB or label table. */
export function countryHasAdmin1(countryCode: string): boolean {
	return listAdmin1ForCountry(countryCode).length > 0;
}

export function getCityByGeoNameId(geonameId: number): GeonamesCityRow | null {
	const rows = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.geoname_id, BigInt(geonameId)))
		.executeSync();
	return rows[0] ? toGeonamesCityRow(rows[0]) : null;
}

function normalizeCityName(name: string): string {
	return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function cityNames(city: GeonamesCityRow): string[] {
	return [city.name, city.asciiName, ...(city.alternateNames?.split(',') ?? [])].map(normalizeCityName);
}

/**
 * Exact name match (case- and accent-insensitive, including alternate names) within a country,
 * optionally restricted to an admin1 subdivision. Among identical names, prefer
 * the highest population.
 */
export function findCityByCountryAndName(
	countryCode: string,
	name: string,
	admin1Code?: string | null
): GeonamesCityRow | null {
	const code = countryCode.toUpperCase();
	const normalized = normalizeCityName(name.trim());
	if (!normalized) return null;
	const admin1 = admin1Code?.trim() || null;
	// The kit ColumnMap omits columns whose names collide with TableSpec keys
	// (e.g. `name`), so filter by country code and match in memory.
	const rows = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.country_code, code))
		.executeSync();
	const matches = rows
		.map(toGeonamesCityRow)
		.filter((r) => {
			if (!cityNames(r).includes(normalized)) {
				return false;
			}
			if (admin1) {
				return (r.admin1Code ?? '').toUpperCase() === admin1.toUpperCase();
			}
			return true;
		});
	if (matches.length === 0) return null;
	matches.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
	return matches[0]!;
}

export function searchCities(
	query: string,
	countryCode?: string,
	limit = 20,
	admin1Code?: string | null
): GeonamesCityRow[] {
	const q = normalizeCityName(query.trim());
	if (!q || q.length < 2) return [];

	const code = countryCode?.toUpperCase();
	const admin1 = admin1Code?.trim() || null;
	// Fetch a generous candidate set ordered by population; filter in memory
	// because the kit query builder does not expose a LIKE predicate.
	let candidates: GeonamesCityRow[];
	if (code) {
		const rows = kit
			.selectFrom(geonamesCities)
			.where(eq(geonamesCities.country_code, code))
			.orderBy(desc(geonamesCities.population))
			.limit(2000)
			.executeSync();
		candidates = rows.map(toGeonamesCityRow);
	} else {
		const rows = kit
			.selectFrom(geonamesCities)
			.orderBy(desc(geonamesCities.population))
			.limit(5000)
			.executeSync();
		candidates = rows.map(toGeonamesCityRow);
	}

	if (admin1) {
		const a = admin1.toUpperCase();
		candidates = candidates.filter((c) => (c.admin1Code ?? '').toUpperCase() === a);
	}

	const filtered = candidates.filter(
		(c) =>
			cityNames(c).some((name) => name.includes(q))
	);

	filtered.sort((a, b) => {
		const aExact = cityNames(a).includes(q);
		const bExact = cityNames(b).includes(q);
		if (aExact && !bExact) return -1;
		if (!aExact && bExact) return 1;
		const ap = a.population ?? 0;
		const bp = b.population ?? 0;
		return bp - ap;
	});

	return filtered.slice(0, limit);
}

export function listCitiesByCountry(countryCode: string, limit = 1000): GeonamesCityRow[] {
	const rows = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.country_code, countryCode.toUpperCase()))
		.orderBy(desc(geonamesCities.population))
		.limit(limit)
		.executeSync();
	return rows.map(toGeonamesCityRow);
}

export function listTopCitiesByPopulation(limit = 1000): GeonamesCityRow[] {
	const rows = kit
		.selectFrom(geonamesCities)
		.orderBy(desc(geonamesCities.population))
		.limit(limit)
		.executeSync();
	return rows.map(toGeonamesCityRow);
}

export function countCities(): number {
	return Number(kit.selectFrom(geonamesCities).selectCount().executeSync());
}

export * from './fareDataRepo';
