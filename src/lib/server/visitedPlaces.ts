import { error } from '@sveltejs/kit';
import { eq as kitEq, and as kitAnd, asc as kitAsc, inList as kitInList } from '@visorcraft/mongreldb-kit';
import { kit } from '$lib/server/db';
import { visitedCountries, visitedUsStates, trips, segments } from '$lib/server/db/mongrelSchema';
import type { Row } from '@visorcraft/mongreldb-kit';
import { COUNTRIES } from '$lib/countries';
import { isUsStateCode } from '$lib/usStates';
import { logAudit } from '$lib/server/audit';
import { requireOwnedTrip } from '$lib/server/ownership';
import { lookupUsStateFromLatLng } from './usStateLookup';
import type { Trip } from './repositories/tripsRepo';

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

export interface CountryVisitSummary {
	code: string;
	firstAt: string | null;
	lastAt: string | null;
	tripCount: number;
}

export function countryVisitSummaries(userId: number): CountryVisitSummary[] {
	const visited = listVisitedCountries(userId);
	if (visited.length === 0) return [];

	const stats = new Map<string, { first: string | null; last: string | null; trips: Set<number> }>();
	for (const v of visited) {
		stats.set(v.code, { first: v.visitedOn, last: v.visitedOn, trips: new Set<number>() });
	}

	function touch(code: string, first: string | null, last: string | null, tripId?: number) {
		const upper = code.toUpperCase();
		const s = stats.get(upper);
		if (!s) return;
		if (first && (!s.first || first < s.first)) s.first = first;
		if (last && (!s.last || last > s.last)) s.last = last;
		if (tripId != null) s.trips.add(tripId);
	}

	const ownedTrips = kit.selectFrom(trips).where(kitEq(trips.owner_id, uid(userId))).executeSync();
	const tripMap = new Map<number, Row<typeof trips>>();
	const tripIds: bigint[] = [];
	for (const t of ownedTrips) {
		tripMap.set(Number(t.id), t);
		tripIds.push(t.id);
	}

	for (const t of ownedTrips) {
		if (t.destination_country_code) {
			touch(t.destination_country_code, t.start_date, t.end_date, Number(t.id));
		}
	}

	if (tripIds.length > 0) {
		const segRows = kit.selectFrom(segments).where(kitInList(segments.trip_id, tripIds)).executeSync();
		for (const s of segRows) {
			if (!s.country_code) continue;
			const trip = tripMap.get(Number(s.trip_id));
			const segStart = s.start_at ? s.start_at.slice(0, 10) : null;
			const segEnd = s.end_at ? s.end_at.slice(0, 10) : trip?.end_date ?? null;
			touch(s.country_code, segStart, segEnd, Number(s.trip_id));
		}
	}

	return Array.from(stats.entries())
		.map(([code, s]) => ({
			code,
			firstAt: s.first,
			lastAt: s.last,
			tripCount: s.trips.size
		}))
		.sort((a, b) => a.code.localeCompare(b.code));
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
	const inserted = kit
		.insertInto(visitedCountries)
		.values({
			user_id: uid(userId),
			country_code: normalized,
			visited_on: opts.visitedOn ?? null,
			source: opts.source ?? 'manual'
		})
		.executeSync();
	logAudit(userId, 'places_visit_add', 'visited_country', Number(inserted.id), {
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
	const inserted = kit
		.insertInto(visitedUsStates)
		.values({
			user_id: uid(userId),
			state_code: normalized,
			visited_on: opts.visitedOn ?? null,
			source: opts.source ?? 'manual'
		})
		.executeSync();
	logAudit(userId, 'places_visit_add', 'visited_state', Number(inserted.id), {
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
	logAudit(userId, 'places_visit_remove', 'visited_country', Number(exists[0].id), {
		kind: 'country',
		code: normalized
	});
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
	logAudit(userId, 'places_visit_remove', 'visited_state', Number(exists[0].id), {
		kind: 'state',
		code: normalized
	});
	return { removed: true };
}

export function unmarkVisited(userId: number, kind: PlaceKind, code: string): { removed: boolean } {
	return kind === 'country'
		? unmarkCountryVisited(userId, code)
		: unmarkStateVisited(userId, code);
}

export function clearVisited(userId: number, kind: PlaceKind): number {
	if (kind === 'country') {
		const n = Number(kit.deleteFrom(visitedCountries).where(kitEq(visitedCountries.user_id, uid(userId))).executeSync());
		if (n > 0) logAudit(userId, 'places_visit_clear', 'visited_country', userId, { kind: 'country', count: n });
		return n;
	}
	const n = Number(kit.deleteFrom(visitedUsStates).where(kitEq(visitedUsStates.user_id, uid(userId))).executeSync());
	if (n > 0) logAudit(userId, 'places_visit_clear', 'visited_state', userId, { kind: 'state', count: n });
	return n;
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function tripQualifies(trip: Trip): boolean {
	const today = todayIso();
	return (
		trip.status === 'active' ||
		trip.status === 'completed' ||
		(trip.startDate != null && trip.startDate <= today) ||
		(trip.endDate != null && trip.endDate < today)
	);
}

function dateFromTimestamp(ts: string | null): string | null {
	if (!ts) return null;
	return ts.slice(0, 10);
}

export interface AutoMarkResult {
	countries: string[];
	states: string[];
}

/**
 * Derive distinct country codes (and U.S. state codes when lat/lng place the
 * location inside a state boundary) from a trip's destination and segments.
 * Idempotent; never overwrites an existing row's `visited_on`. Only considers
 * trips that are completed or already started/past.
 */
export function autoMarkFromTrip(userId: number, tripId: number): AutoMarkResult {
	const trip = requireOwnedTrip(userId, tripId);
	const considerTrip = tripQualifies(trip);
	const today = todayIso();

	const candidateCountries = new Set<string>();
	const candidateStates = new Set<string>();

	if (considerTrip && trip.destinationCountryCode) {
		candidateCountries.add(trip.destinationCountryCode.toUpperCase());
		if (trip.destinationCountryCode.toUpperCase() === 'US') {
			const state =
				trip.destinationCityLat != null && trip.destinationCityLng != null
					? lookupUsStateFromLatLng(trip.destinationCityLat, trip.destinationCityLng)
					: null;
			if (state) candidateStates.add(state);
		}
	}

	const segRows = kit.selectFrom(segments).where(kitEq(segments.trip_id, uid(tripId))).executeSync();
	for (const s of segRows) {
		const cc = s.country_code?.toUpperCase();
		if (!cc) continue;
		const startAt = s.start_at || null;
		const inPast = startAt != null && dateFromTimestamp(startAt)! <= today;
		if (!considerTrip && !inPast) continue;

		candidateCountries.add(cc);
		if (cc === 'US') {
			const lat = s.city_lat;
			const lng = s.city_lng;
			const state = lat != null && lng != null ? lookupUsStateFromLatLng(lat, lng) : null;
			if (state) candidateStates.add(state);
		}
	}

	const markedCountries: string[] = [];
	for (const code of candidateCountries) {
		if (!COUNTRY_CODES.has(code)) continue;
		if (markCountryVisited(userId, code, { source: 'trip' }).created) markedCountries.push(code);
	}

	const markedStates: string[] = [];
	for (const code of candidateStates) {
		if (markStateVisited(userId, code, { source: 'trip' }).created) markedStates.push(code);
	}

	return { countries: markedCountries, states: markedStates };
}

export function autoMarkFromAllTrips(userId: number): AutoMarkResult {
	const owned = kit.selectFrom(trips).where(kitEq(trips.owner_id, uid(userId))).executeSync();
	const countries = new Set<string>();
	const states = new Set<string>();
	for (const t of owned) {
		const added = autoMarkFromTrip(userId, Number(t.id));
		for (const c of added.countries) countries.add(c);
		for (const s of added.states) states.add(s);
	}
	return { countries: Array.from(countries), states: Array.from(states) };
}
