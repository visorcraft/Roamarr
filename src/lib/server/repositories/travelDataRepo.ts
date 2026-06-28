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
} from '@mongreldb/kit';
import { eq as drizzleEq, and as drizzleAnd } from 'drizzle-orm';
import { db, kit } from '$lib/server/db';
import {
	geonamesCities,
	fareProviders,
	fareWatches
} from '$lib/server/db/mongrelSchema';
import {
	geonamesCities as drizzleGeonamesCities,
	fareProviders as drizzleFareProviders,
	fareWatches as drizzleFareWatches
} from '$lib/server/db/schema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { nowIso } from '$lib/server/tz';

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

function mirrorGeonamesCitiesToLegacy(cities: GeonamesCityRow[]) {
	db.delete(drizzleGeonamesCities).run();
	if (cities.length === 0) return;
	db.insert(drizzleGeonamesCities)
		.values(
			cities.map((c) => ({
				geonameId: c.geonameId,
				name: c.name,
				asciiName: c.asciiName,
				countryCode: c.countryCode,
				lat: c.lat,
				lng: c.lng,
				population: c.population,
				timezone: c.timezone
			}))
		)
		.run();
}

function cityFromLegacy(geonameId: number): GeonamesCityRow | null {
	const row = db
		.select()
		.from(drizzleGeonamesCities)
		.where(drizzleEq(drizzleGeonamesCities.geonameId, geonameId))
		.get();
	if (!row) return null;
	return {
		geonameId: row.geonameId,
		name: row.name,
		asciiName: row.asciiName,
		countryCode: row.countryCode,
		lat: row.lat,
		lng: row.lng,
		population: row.population ?? null,
		timezone: row.timezone ?? null
	};
}

export function importCitiesBatch(cities: GeonamesCityRow[]): number {
	kit.deleteFrom(geonamesCities).executeSync();
	for (const city of cities) {
		kit.insertInto(geonamesCities).values(toKitGeonamesCityInput(city) as Insert<typeof geonamesCities>).executeSync();
	}
	mirrorGeonamesCitiesToLegacy(cities);
	return cities.length;
}

export function getCityByGeoNameId(geonameId: number): GeonamesCityRow | null {
	const rows = kit
		.selectFrom(geonamesCities)
		.where(eq(geonamesCities.geoname_id, BigInt(geonameId)))
		.executeSync();
	return rows[0] ? toGeonamesCityRow(rows[0]) : cityFromLegacy(geonameId);
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
	if (match) return toGeonamesCityRow(match);

	const legacy = db
		.select()
		.from(drizzleGeonamesCities)
		.where(
			drizzleAnd(
				drizzleEq(drizzleGeonamesCities.countryCode, code),
				drizzleEq(drizzleGeonamesCities.name, name)
			)
		)
		.get();
	return legacy
		? {
				geonameId: legacy.geonameId,
				name: legacy.name,
				asciiName: legacy.asciiName,
				countryCode: legacy.countryCode,
				lat: legacy.lat,
				lng: legacy.lng,
				population: legacy.population ?? null,
				timezone: legacy.timezone ?? null
		  }
		: null;
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

function fareProviderFromLegacy(id: number): FareProviderAccount | null {
	const row = db
		.select()
		.from(drizzleFareProviders)
		.where(drizzleEq(drizzleFareProviders.id, id))
		.get();
	if (!row) return null;
	return {
		id: row.id,
		userId: row.userId,
		providerKey: row.providerKey,
		label: row.label,
		apiKey: row.apiKey ? decrypt(row.apiKey) : null,
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

function mirrorFareProviderToLegacy(row: Row<typeof fareProviders>) {
	const id = Number(row.id);
	const existing = db
		.select()
		.from(drizzleFareProviders)
		.where(drizzleEq(drizzleFareProviders.id, id))
		.get();
	const values = {
		userId: Number(row.user_id),
		providerKey: row.provider_key,
		label: row.label,
		apiKey: row.api_key,
		enabled: row.enabled
	};
	if (existing) {
		db.update(drizzleFareProviders)
			.set(values)
			.where(drizzleEq(drizzleFareProviders.id, id))
			.run();
	} else {
		db.insert(drizzleFareProviders).values({ id, ...values }).run();
	}
}

function deleteFareProviderFromLegacy(id: number) {
	db.delete(drizzleFareProviders).where(drizzleEq(drizzleFareProviders.id, id)).run();
}

export function listFareProvidersForUser(userId: number): FareProviderAccount[] {
	const rows = kit
		.selectFrom(fareProviders)
		.where(eq(fareProviders.user_id, BigInt(userId)))
		.orderBy(asc(fareProviders.id))
		.executeSync();
	return rows.map(toFareProviderAccount);
}

export function getFareProviderById(id: number): FareProviderAccount | null {
	const rows = kit
		.selectFrom(fareProviders)
		.where(eq(fareProviders.id, BigInt(id)))
		.executeSync();
	return rows[0] ? toFareProviderAccount(rows[0]) : fareProviderFromLegacy(id);
}

export function getFareProviderByIdAndUser(id: number, userId: number): FareProviderAccount | null {
	const rows = kit
		.selectFrom(fareProviders)
		.where(and(eq(fareProviders.id, BigInt(id)), eq(fareProviders.user_id, BigInt(userId))))
		.executeSync();
	return rows[0] ? toFareProviderAccount(rows[0]) : null;
}

function nextFareProviderId(): bigint {
	const rows = kit.selectFrom(fareProviders).orderBy(desc(fareProviders.id)).limit(1).executeSync();
	return rows[0] ? rows[0].id + 1n : 1n;
}

export function createFareProvider(input: CreateFareProviderInput): FareProviderAccount {
	const row = kit
		.insertInto(fareProviders)
		.values({
			id: nextFareProviderId(),
			...toKitFareProviderInput(input)
		} as unknown as Insert<typeof fareProviders>)
		.executeSync();
	mirrorFareProviderToLegacy(row);
	return toFareProviderAccount(row);
}

export function updateFareProvider(id: number, patch: UpdateFareProviderInput): FareProviderAccount | null {
	const existing = getFareProviderById(id);
	if (!existing) return null;

	const set: Update<typeof fareProviders> = {};
	if (patch.label !== undefined) set.label = patch.label.trim();
	if (patch.enabled !== undefined) set.enabled = patch.enabled;
	if (patch.apiKey !== undefined && patch.apiKey !== null && patch.apiKey !== '') {
		set.api_key = encrypt(patch.apiKey);
	}

	const updated = kit.updateTable(fareProviders).set(set).where(eq(fareProviders.id, BigInt(id))).executeSync();
	const row = updated[0];
	if (!row) return existing;
	mirrorFareProviderToLegacy(row);
	return toFareProviderAccount(row);
}

export function deleteFareProvider(id: number): boolean {
	const existing = getFareProviderById(id);
	if (!existing) return false;
	kit.deleteFrom(fareProviders).where(eq(fareProviders.id, BigInt(id))).executeSync();
	deleteFareProviderFromLegacy(id);
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

function fareWatchFromLegacy(id: number): FareWatch | null {
	const row = db
		.select()
		.from(drizzleFareWatches)
		.where(drizzleEq(drizzleFareWatches.id, id))
		.get();
	if (!row) return null;
	return {
		id: row.id,
		tripId: row.tripId,
		segmentId: row.segmentId ?? null,
		providerId: row.providerId,
		status: row.status as FareWatchStatus,
		lastCheckedAt: row.lastCheckedAt ?? null,
		lastResultJson: row.lastResultJson ?? null,
		createdAt: row.createdAt
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

function mirrorFareWatchToLegacy(row: Row<typeof fareWatches>) {
	const id = Number(row.id);
	const existing = db
		.select()
		.from(drizzleFareWatches)
		.where(drizzleEq(drizzleFareWatches.id, id))
		.get();
	const values = {
		tripId: Number(row.trip_id),
		segmentId: row.segment_id == null || row.segment_id === 0n ? null : Number(row.segment_id),
		providerId: Number(row.provider_id),
		status: row.status,
		lastCheckedAt: row.last_checked_at,
		lastResultJson: row.last_result_json ? String(row.last_result_json) : null,
		createdAt: row.created_at
	};
	if (existing) {
		db.update(drizzleFareWatches)
			.set(values)
			.where(drizzleEq(drizzleFareWatches.id, id))
			.run();
	} else {
		db.insert(drizzleFareWatches).values({ id, ...values }).run();
	}
}

function deleteFareWatchFromLegacy(id: number) {
	db.delete(drizzleFareWatches).where(drizzleEq(drizzleFareWatches.id, id)).run();
}

export function getFareWatchById(id: number): FareWatch | null {
	const rows = kit
		.selectFrom(fareWatches)
		.where(eq(fareWatches.id, BigInt(id)))
		.executeSync();
	return rows[0] ? toFareWatch(rows[0]) : fareWatchFromLegacy(id);
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

export interface FareWatchWithProvider extends FareWatch {
	provider: FareProviderAccount;
}

export function listActiveFareWatches(): FareWatchWithProvider[] {
	const watchRows = kit
		.selectFrom(fareWatches)
		.where(eq(fareWatches.status, 'active'))
		.executeSync();
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

function nextFareWatchId(): bigint {
	const rows = kit.selectFrom(fareWatches).orderBy(desc(fareWatches.id)).limit(1).executeSync();
	return rows[0] ? rows[0].id + 1n : 1n;
}

export function createFareWatch(input: CreateFareWatchInput): FareWatch {
	const row = kit
		.insertInto(fareWatches)
		.values({
			id: nextFareWatchId(),
			...toKitFareWatchInput(input)
		} as unknown as Insert<typeof fareWatches>)
		.executeSync();
	mirrorFareWatchToLegacy(row);
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
	mirrorFareWatchToLegacy(row);
	return toFareWatch(row);
}

export function deleteFareWatch(id: number): boolean {
	const existing = getFareWatchById(id);
	if (!existing) return false;
	kit.deleteFrom(fareWatches).where(eq(fareWatches.id, BigInt(id))).executeSync();
	deleteFareWatchFromLegacy(id);
	return true;
}

export function touchFareWatch(id: number): FareWatch | null {
	return updateFareWatch(id, { lastCheckedAt: nowIso() });
}
