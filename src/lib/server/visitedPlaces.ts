import { error } from '@sveltejs/kit';
import {
	eq as kitEq,
	and as kitAnd,
	asc as kitAsc
} from '@mongreldb/kit';
import { kit } from '$lib/server/db';
import { visitedCountries, visitedUsStates, trips, segments } from '$lib/server/db/mongrelSchema';
import type { Row } from '@mongreldb/kit';
import { COUNTRIES } from '$lib/countries';
import { isUsStateCode } from '$lib/usStates';
import { logAudit } from '$lib/server/audit';
import { requireOwnedTrip } from '$lib/server/ownership';

export type KitVisitedCountry = Row<typeof visitedCountries>;
export type KitVisitedUsState = Row<typeof visitedUsStates>;

export interface VisitedPlace {
	code: string;
	visitedOn: string | null;
	source: string;
	createdAt: string;
}

export type PlaceKind = 'country' | 'state';

const COUNTRY_CODES = new Set<string>(COUNTRIES.map((c) => c.code));
const uid = (id: number): bigint => BigInt(id);

function toPlaceCountry(row: KitVisitedCountry): VisitedPlace {
	return {
		code: row.country_code,
		visitedOn: row.visited_on,
		source: row.source,
		createdAt: row.created_at
	};
}

function toPlaceState(row: KitVisitedUsState): VisitedPlace {
	return {
		code: row.state_code,
		visitedOn: row.visited_on,
		source: row.source,
		createdAt: row.created_at
	};
}

export function listVisitedCountries(userId: number): VisitedPlace[] {
	const rows = kit
		.selectFrom(visitedCountries)
		.where(kitEq(visitedCountries.user_id, uid(userId)))
		.orderBy(kitAsc(visitedCountries.country_code))
		.executeSync();
	return rows.map(toPlaceCountry);
}

export function listVisitedUsStates(userId: number): VisitedPlace[] {
	const rows = kit
		.selectFrom(visitedUsStates)
		.where(kitEq(visitedUsStates.user_id, uid(userId)))
		.orderBy(kitAsc(visitedUsStates.state_code))
		.executeSync();
	return rows.map(toPlaceState);
}

export function listVisited(userId: number): { countries: VisitedPlace[]; usStates: VisitedPlace[] } {
	return { countries: listVisitedCountries(userId), usStates: listVisitedUsStates(userId) };
}

function validateCountry(code: string): string {
	const upper = code.trim().toUpperCase();
	if (!COUNTRY_CODES.has(upper)) throw error(400, `Unknown country code: ${upper}`);
	return upper;
}

function validateState(code: string): string {
	const upper = code.trim().toUpperCase();
	if (!isUsStateCode(upper)) throw error(400, `Unknown U.S. state code: ${upper}`);
	return upper;
}

export function markCountryVisited(
	userId: number,
	code: string,
	opts: { visitedOn?: string | null; source?: string } = {}
): { created: boolean } {
	const normalized = validateCountry(code);
	const exists = kit
		.selectFrom(visitedCountries)
		.where(kitAnd(kitEq(visitedCountries.user_id, uid(userId)), kitEq(visitedCountries.country_code, normalized)))
		.executeSync();
	if (exists.length > 0) return { created: false };
	kit.insertInto(visitedCountries)
		.values({
			user_id: uid(userId),
			country_code: normalized,
			visited_on: opts.visitedOn ?? null,
			source: opts.source ?? 'manual'
		})
		.executeSync();
	logAudit(userId, 'places_visit_add', 'visited_country', userId, {
		kind: 'country',
		code: normalized,
		source: opts.source ?? 'manual'
	});
	return { created: true };
}

export function markStateVisited(
	userId: number,
	code: string,
	opts: { visitedOn?: string | null; source?: string } = {}
): { created: boolean } {
	const normalized = validateState(code);
	const exists = kit
		.selectFrom(visitedUsStates)
		.where(kitAnd(kitEq(visitedUsStates.user_id, uid(userId)), kitEq(visitedUsStates.state_code, normalized)))
		.executeSync();
	if (exists.length > 0) return { created: false };
	kit.insertInto(visitedUsStates)
		.values({
			user_id: uid(userId),
			state_code: normalized,
			visited_on: opts.visitedOn ?? null,
			source: opts.source ?? 'manual'
		})
		.executeSync();
	logAudit(userId, 'places_visit_add', 'visited_state', userId, {
		kind: 'state',
		code: normalized,
		source: opts.source ?? 'manual'
	});
	return { created: true };
}

export function markVisited(
	userId: number,
	kind: PlaceKind,
	code: string,
	opts: { visitedOn?: string | null; source?: string } = {}
): { created: boolean } {
	return kind === 'country'
		? markCountryVisited(userId, code, opts)
		: markStateVisited(userId, code, opts);
}

export function unmarkCountryVisited(userId: number, code: string): { removed: boolean } {
	const normalized = validateCountry(code);
	const exists = kit
		.selectFrom(visitedCountries)
		.where(kitAnd(kitEq(visitedCountries.user_id, uid(userId)), kitEq(visitedCountries.country_code, normalized)))
		.executeSync();
	if (exists.length === 0) return { removed: false };
	kit.deleteFrom(visitedCountries)
		.where(kitAnd(kitEq(visitedCountries.user_id, uid(userId)), kitEq(visitedCountries.country_code, normalized)))
		.executeSync();
	logAudit(userId, 'places_visit_remove', 'visited_country', userId, { kind: 'country', code: normalized });
	return { removed: true };
}

export function unmarkStateVisited(userId: number, code: string): { removed: boolean } {
	const normalized = validateState(code);
	const exists = kit
		.selectFrom(visitedUsStates)
		.where(kitAnd(kitEq(visitedUsStates.user_id, uid(userId)), kitEq(visitedUsStates.state_code, normalized)))
		.executeSync();
	if (exists.length === 0) return { removed: false };
	kit.deleteFrom(visitedUsStates)
		.where(kitAnd(kitEq(visitedUsStates.user_id, uid(userId)), kitEq(visitedUsStates.state_code, normalized)))
		.executeSync();
	logAudit(userId, 'places_visit_remove', 'visited_state', userId, { kind: 'state', code: normalized });
	return { removed: true };
}

export function unmarkVisited(userId: number, kind: PlaceKind, code: string): { removed: boolean } {
	return kind === 'country'
		? unmarkCountryVisited(userId, code)
		: unmarkStateVisited(userId, code);
}

export function clearVisited(userId: number, kind: PlaceKind): number {
	if (kind === 'country') {
		const n = Number(
			kit.deleteFrom(visitedCountries).where(kitEq(visitedCountries.user_id, uid(userId))).executeSync()
		);
		if (n > 0) logAudit(userId, 'places_visit_clear', 'visited_country', userId, { kind: 'country', count: n });
		return n;
	}
	const n = Number(
		kit.deleteFrom(visitedUsStates).where(kitEq(visitedUsStates.user_id, uid(userId))).executeSync()
	);
	if (n > 0) logAudit(userId, 'places_visit_clear', 'visited_state', userId, { kind: 'state', count: n });
	return n;
}

/**
 * Derive distinct country codes from a trip's segments (and destination) and
 * mark any not yet recorded. Idempotent; never overwrites an existing row's
 * `visited_on`. Only considers trips that are completed or already started.
 *
 * U.S. states are intentionally left to manual marking — segments do not store
 * a sub-division code and we do not perform offline reverse geocoding.
 */
export function autoMarkCountriesFromTrip(userId: number, tripId: number): string[] {
	requireOwnedTrip(userId, tripId);
	const trip = kit.selectFrom(trips).where(kitEq(trips.id, uid(tripId))).executeSync()[0];
	if (!trip) return [];
	const tripStatus = trip.status as string;
	// Nullable date columns read back as "" (not null) from MongrelDB Kit when
	// unset — coerce empties to null so the absence checks below behave.
	const tripStart = (trip.start_date as string) || null;
	const tripEnd = (trip.end_date as string) || null;
	const today = new Date().toISOString().slice(0, 10);

	// A trip counts once it is underway or finished ('active'/'completed'), or
	// once its dates place it in the past even if the status lags behind.
	const considerTrip =
		tripStatus === 'active' ||
		tripStatus === 'completed' ||
		(tripStart != null && tripStart.slice(0, 10) <= today) ||
		(tripEnd != null && tripEnd.slice(0, 10) < today);

	const candidateCountries = new Set<string>();
	if (considerTrip && trip.destination_country_code) {
		candidateCountries.add((trip.destination_country_code as string).toUpperCase());
	}

	const segRows = kit.selectFrom(segments).where(kitEq(segments.trip_id, uid(tripId))).executeSync();
	for (const s of segRows) {
		const cc = (s.country_code as string | null)?.toUpperCase();
		if (!cc) continue;
		const startAt = (s.start_at as string) || null;
		const inPast = startAt != null && startAt.slice(0, 10) <= today;
		if (considerTrip || inPast) candidateCountries.add(cc);
	}

	const marked: string[] = [];
	for (const code of candidateCountries) {
		if (!COUNTRY_CODES.has(code)) continue;
		if (markCountryVisited(userId, code, { source: 'trip' }).created) marked.push(code);
	}
	return marked;
}

export function autoMarkCountriesFromAllTrips(userId: number): string[] {
	const owned = kit.selectFrom(trips).where(kitEq(trips.owner_id, uid(userId))).executeSync();
	const marked = new Set<string>();
	for (const t of owned) {
		for (const code of autoMarkCountriesFromTrip(userId, Number(t.id))) marked.add(code);
	}
	return Array.from(marked);
}
