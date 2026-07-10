import {
	eq,
	and,
	or,
	isNull,
	inList,
	desc,
	asc,
	type Row,
	type Insert,
	type Update
} from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import {
	geonamesCities,
	fareProviders,
	fareWatches
} from '$lib/server/db/mongrelSchema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { compareRows } from '$lib/server/sortUtils';

// ============================================================================
// GeoNames cities
// ============================================================================

export interface GeonamesCityRow {
	geonameId: number;
	name: string;
	asciiName: string;
	countryCode: string;
	lat: number;
	lng: number;
	population: number | null;
	timezone: string | null;
}

function toGeonamesCityRow(row: Row<typeof geonamesCities>): GeonamesCityRow {
	return {
		geonameId: Number(row.geoname_id),
		name: row.name,
		asciiName: row.ascii_name,
		countryCode: row.country_code,
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
		country_code: row.countryCode,
		lat: row.lat,
		lng: row.lng,
		population: row.population == null ? null : BigInt(row.population),
		timezone: row.timezone
	};
}

export function importCitiesBatch(cities: GeonamesCityRow[]): number {
	kit.deleteFrom(geonamesCities).executeSync();
	if (cities.length === 0) return 0;
	// One transaction for the whole batch — far faster than a row-at-a-time loop.
	kit
		.insertInto(geonamesCities)
		.valuesMany(cities.map((city) => toKitGeonamesCityInput(city) as Insert<typeof geonamesCities>))
		.executeSync();
	return cities.length;
}

export function getCityByGeoNameId(geonameId: number): GeonamesCityRow | null {
	const rows = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.geoname_id, BigInt(geonameId)))
		.executeSync();
	return rows[0] ? toGeonamesCityRow(rows[0]) : null;
}

export function findCityByCountryAndName(countryCode: string, name: string): GeonamesCityRow | null {
	const code = countryCode.toUpperCase();
	// The kit ColumnMap omits columns whose names collide with TableSpec keys
	// (e.g. `name`), so filter by country code and match in memory.
	const rows = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.country_code, code))
		.executeSync();
	const match = rows.find((r) => r.name === name);
	return match ? toGeonamesCityRow(match) : null;
}

export function searchCities(
	query: string,
	countryCode?: string,
	limit = 20
): GeonamesCityRow[] {
	const q = query.trim().toLowerCase();
	if (!q || q.length < 2) return [];

	const code = countryCode?.toUpperCase();
	// Fetch a generous candidate set ordered by population; filter in memory
	// because the kit query builder does not expose a LIKE predicate.
	let candidates: GeonamesCityRow[];
	if (code) {
		const rows = kit
			.selectFrom(geonamesCities)
			.where(eq(geonamesCities.country_code, code))
			.orderBy(desc(geonamesCities.population))
			.limit(1000)
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

	const filtered = candidates.filter(
		(c) =>
			c.name.toLowerCase().includes(q) || c.asciiName.toLowerCase().includes(q)
	);

	filtered.sort((a, b) => {
		const aExact = a.name.toLowerCase() === q || a.asciiName.toLowerCase() === q;
		const bExact = b.name.toLowerCase() === q || b.asciiName.toLowerCase() === q;
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

// ============================================================================
// Fare providers
// ============================================================================

export interface FareProviderAccount {
	id: number;
	userId: number;
	providerKey: string;
	label: string;
	apiKey: string | null;
	enabled: boolean;
}

export interface CreateFareProviderInput {
	userId: number;
	providerKey: string;
	label: string;
	apiKey: string | null;
	enabled: boolean;
}

export type UpdateFareProviderInput = Partial<
	Omit<CreateFareProviderInput, 'userId' | 'providerKey'>
>;

function toFareProviderAccount(row: Row<typeof fareProviders>): FareProviderAccount {
	return {
		id: Number(row.id),
		userId: Number(row.user_id),
		providerKey: row.provider_key,
		label: row.label,
		apiKey: row.api_key ? decrypt(row.api_key) : null,
		enabled: row.enabled
	};
}

function toKitFareProviderInput(input: CreateFareProviderInput): Record<string, unknown> {
	return {
		user_id: BigInt(input.userId),
		provider_key: input.providerKey,
		label: input.label.trim(),
		api_key: input.apiKey ? encrypt(input.apiKey) : null,
		enabled: input.enabled
	};
}

export function listFareProvidersForUser(userId: number): FareProviderAccount[] {
	const rows = kit
		.selectFrom(fareProviders)
		.where(eq(fareProviders.user_id, BigInt(userId)))
		.orderBy(asc(fareProviders.id))
		.executeSync();
	return rows.map(toFareProviderAccount);
}

export interface ListFareProvidersOptions {
	search?: string;
	sortBy?: 'providerKey' | 'label' | 'enabled';
	sortDir?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export function listFareProvidersForUserPaginated(
	userId: number,
	opts: ListFareProvidersOptions = {}
): FareProviderAccount[] {
	let rows = listFareProvidersForUser(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(p) =>
				p.providerKey.toLowerCase().includes(q) ||
				p.label.toLowerCase().includes(q)
		);
	}
	const sortBy = opts.sortBy ?? 'label';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countFareProvidersForUser(userId: number, search?: string): number {
	if (!search?.trim()) {
		return Number(
			kit
				.selectFrom(fareProviders)
				.where(eq(fareProviders.user_id, BigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	const q = search.trim().toLowerCase();
	return listFareProvidersForUser(userId).filter(
		(p) =>
			p.providerKey.toLowerCase().includes(q) ||
			p.label.toLowerCase().includes(q)
	).length;
}

export function getFareProviderById(id: number): FareProviderAccount | null {
	const rows = kit
		.selectFrom(fareProviders)
		.where(eq(fareProviders.id, BigInt(id)))
		.executeSync();
	return rows[0] ? toFareProviderAccount(rows[0]) : null;
}

export function getFareProviderByIdAndUser(id: number, userId: number): FareProviderAccount | null {
	const rows = kit
		.selectFrom(fareProviders)
		.where(and(eq(fareProviders.id, BigInt(id)), eq(fareProviders.user_id, BigInt(userId))))
		.executeSync();
	return rows[0] ? toFareProviderAccount(rows[0]) : null;
}

export function createFareProvider(input: CreateFareProviderInput): FareProviderAccount {
	const row = kit
		.insertInto(fareProviders)
		.values(toKitFareProviderInput(input) as unknown as Insert<typeof fareProviders>)
		.executeSync();
	return toFareProviderAccount(row);
}

export function updateFareProvider(id: number, patch: UpdateFareProviderInput): FareProviderAccount | null {
	const set: Update<typeof fareProviders> = {};
	if (patch.label !== undefined) set.label = patch.label.trim();
	if (patch.enabled !== undefined) set.enabled = patch.enabled;
	if (patch.apiKey !== undefined && patch.apiKey !== null && patch.apiKey !== '') {
		set.api_key = encrypt(patch.apiKey);
	}

	const updated = kit.updateTable(fareProviders).set(set).where(eq(fareProviders.id, BigInt(id))).executeSync();
	const row = updated[0];
	if (!row) return getFareProviderById(id);
	return toFareProviderAccount(row);
}

export function deleteFareProvider(id: number): boolean {
	const existing = getFareProviderById(id);
	if (!existing) return false;
	kit.deleteFrom(fareProviders).where(eq(fareProviders.id, BigInt(id))).executeSync();
	return true;
}

// ============================================================================
// Fare watches
// ============================================================================

export type FareWatchStatus = 'active' | 'paused';

export interface FareWatch {
	id: number;
	tripId: number;
	segmentId: number | null;
	providerId: number;
	status: FareWatchStatus;
	lastCheckedAt: string | null;
	lastResultJson: string | null;
	createdAt: string;
}

export interface CreateFareWatchInput {
	tripId: number;
	segmentId?: number | null;
	providerId: number;
	status?: FareWatchStatus;
}

export type UpdateFareWatchInput = Partial<
	Omit<CreateFareWatchInput, 'tripId' | 'providerId'>
> & {
	lastCheckedAt?: string | null;
	lastResultJson?: string | null;
};

function nullableTimestamp(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : value;
}

function nullableJson(value: unknown): string | null {
	return value == null || value === '' ? null : String(value);
}

function toFareWatch(row: Row<typeof fareWatches>): FareWatch {
	return {
		id: Number(row.id),
		tripId: Number(row.trip_id),
		segmentId: row.segment_id == null || row.segment_id === 0n ? null : Number(row.segment_id),
		providerId: Number(row.provider_id),
		status: row.status as FareWatchStatus,
		lastCheckedAt: nullableTimestamp(row.last_checked_at),
		lastResultJson: nullableJson(row.last_result_json),
		createdAt: row.created_at
	};
}

function toKitFareWatchInput(input: CreateFareWatchInput): Record<string, unknown> {
	return {
		trip_id: BigInt(input.tripId),
		segment_id: input.segmentId == null ? null : BigInt(input.segmentId),
		provider_id: BigInt(input.providerId),
		status: input.status ?? 'active',
		last_checked_at: null,
		last_result_json: null
	};
}

export function getFareWatchById(id: number): FareWatch | null {
	const rows = kit
		.selectFrom(fareWatches)
		.where(eq(fareWatches.id, BigInt(id)))
		.executeSync();
	return rows[0] ? toFareWatch(rows[0]) : null;
}

function nullIntPredicate(column: typeof fareWatches.segment_id) {
	// MongrelDB Kit stores nullable int nulls as 0n, so match both representations.
	return or(isNull(column), eq(column, 0n));
}

export function getFareWatchByTripAndProvider(
	tripId: number,
	providerId: number,
	segmentId?: number | null
): FareWatch | null {
	const segmentPredicate =
		segmentId == null
			? nullIntPredicate(fareWatches.segment_id)
			: eq(fareWatches.segment_id, BigInt(segmentId));
	const rows = kit
		.selectFrom(fareWatches)
		.where(
			and(
				eq(fareWatches.trip_id, BigInt(tripId)),
				eq(fareWatches.provider_id, BigInt(providerId)),
				segmentPredicate
			)
		)
		.executeSync();
	return rows[0] ? toFareWatch(rows[0]) : null;
}

export function listFareWatchesForUser(userId: number): FareWatch[] {
	const providers = listFareProvidersForUser(userId);
	if (providers.length === 0) return [];
	const providerIds = providers.map((p) => BigInt(p.id));
	const rows = kit
		.selectFrom(fareWatches)
		.where(inList(fareWatches.provider_id, providerIds))
		.orderBy(asc(fareWatches.id))
		.executeSync();
	return rows.map(toFareWatch);
}

export function countFareWatchesForUser(userId: number): number {
	const providerRows = kit
		.selectFrom(fareProviders)
		.where(eq(fareProviders.user_id, BigInt(userId)))
		.executeSync();
	const providerIds = providerRows.map((p) => p.id);
	if (providerIds.length === 0) return 0;
	return kit.selectFrom(fareWatches).where(inList(fareWatches.provider_id, providerIds)).executeSync()
		.length;
}

export interface FareWatchWithProvider extends FareWatch {
	provider: FareProviderAccount;
}

export function listActiveFareWatches(opts: { limit?: number } = {}): FareWatchWithProvider[] {
	const watchQuery = kit
		.selectFrom(fareWatches)
		.where(eq(fareWatches.status, 'active'))
		.orderBy(asc(fareWatches.last_checked_at));
	const watchRows = (opts.limit != null ? watchQuery.limit(opts.limit) : watchQuery).executeSync();
	if (watchRows.length === 0) return [];

	const providerIds = Array.from(new Set(watchRows.map((w) => Number(w.provider_id))));
	const providers = providerIds
		.map((id) => getFareProviderById(id))
		.filter((p): p is FareProviderAccount => p != null && p.enabled);
	const providerMap = new Map(providers.map((p) => [p.id, p]));

	return watchRows
		.map(toFareWatch)
		.filter((w) => providerMap.has(w.providerId))
		.map((w) => ({ ...w, provider: providerMap.get(w.providerId)! }));
}

export function createFareWatch(input: CreateFareWatchInput): FareWatch {
	const row = kit
		.insertInto(fareWatches)
		.values(toKitFareWatchInput(input) as unknown as Insert<typeof fareWatches>)
		.executeSync();
	return toFareWatch(row);
}

export function updateFareWatch(id: number, patch: UpdateFareWatchInput): FareWatch | null {
	const set: Update<typeof fareWatches> = {};
	if (patch.segmentId !== undefined) {
		set.segment_id = patch.segmentId == null ? null : BigInt(patch.segmentId);
	}
	if (patch.status !== undefined) set.status = patch.status;
	if (patch.lastCheckedAt !== undefined) set.last_checked_at = patch.lastCheckedAt;
	if (patch.lastResultJson !== undefined) {
		set.last_result_json = patch.lastResultJson == null ? null : patch.lastResultJson;
	}

	const updated = kit.updateTable(fareWatches).set(set).where(eq(fareWatches.id, BigInt(id))).executeSync();
	const row = updated[0];
	if (!row) return getFareWatchById(id);
	return toFareWatch(row);
}

export function deleteFareWatch(id: number): boolean {
	const existing = getFareWatchById(id);
	if (!existing) return false;
	kit.deleteFrom(fareWatches).where(eq(fareWatches.id, BigInt(id))).executeSync();
	return true;
}
