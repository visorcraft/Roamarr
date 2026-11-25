import { test, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load as loadCountries, actions as countryActions } from './countries/+page.server';
import { load as loadStates, actions as stateActions } from './states/+page.server';
import { users, visitedCountries, visitedUsStates, trips, segments } from '$lib/server/db/mongrelSchema';
import { makeUser, makeTrip, makeSegment } from '../../../../tests/helpers';
import { todayInTimezone } from '$lib/tripStatus';
import { autoMarkFromTrip, autoMarkFromAllTrips } from '$lib/server/visitedPlaces';
import { eq } from '@visorcraft/mongreldb-kit';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

function makeLocals(u: { id: number; role: string; autoMarkVisited?: boolean }) {
	return {
		user: {
			id: u.id,
			role: u.role,
			autoMarkVisited: u.autoMarkVisited ?? false
		}
	} as App.Locals;
}

function makeFormEvent(
	u: { id: number; role: string },
	record: Record<string, string>,
	action: string,
	path = '/profile/visited/countries'
) {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.set(k, v);
	return {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		request: new Request(`http://localhost${path}?/${action}`, {
			method: 'POST',
			body: form
		})
	} as any;
}

beforeEach(() => {
	const kit = kitDb();
	kit.deleteFrom(visitedUsStates).executeSync();
	kit.deleteFrom(visitedCountries).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('country load returns paginated rows and counts without side effects', () => {
	const u = makeUser(kitDb(), { email: 'u@x.c', autoMarkVisited: true });
	const t = makeTrip(kitDb(), u.id, {
		destinationCountryCode: 'FR',
		status: 'completed'
	});
	const data = loadCountries({
		locals: makeLocals({ id: u.id, role: u.role, autoMarkVisited: true }),
		url: new URL('http://localhost/profile/visited/countries')
	} as any) as any;
	expect(data.rows).toEqual([]);
	expect(data.countryCount).toBe(0);
	expect(data.stateCount).toBe(0);
	expect(data.autoMarkVisited).toBe(true);
	expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
	expect(kitDb().selectFrom(visitedUsStates).executeSync()).toHaveLength(0);
	expect(kitDb().selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()).toHaveLength(1);
});

test('state load returns state rows', () => {
	const u = makeUser(kitDb(), { email: 'state@x.c' });
	kitDb()
		.insertInto(visitedUsStates)
		.values({
			user_id: BigInt(u.id),
			state_code: 'US-CA',
			visited_on: '2024-01-01',
			first_visited_on: '2024-01-01',
			last_visited_on: '2024-02-01',
			source: 'manual'
		})
		.executeSync();
	const data = loadStates({
		locals: makeLocals(u),
		url: new URL('http://localhost/profile/visited/states?q=cal')
	} as any) as any;
	expect(data.rows).toMatchObject([{ code: 'US-CA', name: 'California', firstVisitedOn: '2024-01-01', lastVisitedOn: '2024-02-01' }]);
});

test('mark country action persists first and last visited dates', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { code: 'jp', firstVisitedOn: '2022-07-15', lastVisitedOn: '2022-07-30' }, 'mark');
	await expect(countryActions.mark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/countries'
	});
	expect(event.cookies.set).toHaveBeenCalledWith('flash', 'Marked JP as visited.', expect.any(Object));
	const row = kitDb().selectFrom(visitedCountries).executeSync()[0]!;
	expect(row.country_code).toBe('JP');
	expect(row.visited_on).toBe('2022-07-15');
	expect(row.first_visited_on).toBe('2022-07-15');
	expect(row.last_visited_on).toBe('2022-07-30');
});

test('mark state action persists a US state', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { code: 'ca' }, 'mark', '/profile/visited/states');
	await expect(stateActions.mark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/states'
	});
	expect(kitDb().selectFrom(visitedUsStates).executeSync()[0]!.state_code).toBe('US-CA');
});

test('update action edits visit date range', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb()
		.insertInto(visitedCountries)
		.values({
			user_id: BigInt(u.id),
			country_code: 'DE',
			visited_on: '2023-01-01',
			first_visited_on: '2023-01-01',
			last_visited_on: '2023-01-01',
			source: 'manual'
		})
		.executeSync();
	const event = makeFormEvent(u, { code: 'de', firstVisitedOn: '2021-05-01', lastVisitedOn: '2024-06-01' }, 'update');
	await expect(countryActions.update(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/countries'
	});
	const row = kitDb().selectFrom(visitedCountries).executeSync()[0]!;
	expect(row.first_visited_on).toBe('2021-05-01');
	expect(row.last_visited_on).toBe('2024-06-01');
});

test('update action rejects inverted dates', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { code: 'de', firstVisitedOn: '2024-06-01', lastVisitedOn: '2021-05-01' }, 'update');
	const result = await countryActions.update(event);
	expect(result).toMatchObject({ status: 400, data: { error: 'Last visited must be on or after first visited.' } });
});

test('unmark action removes a country', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb()
		.insertInto(visitedCountries)
		.values({ user_id: BigInt(u.id), country_code: 'DE', visited_on: null, source: 'manual' })
		.executeSync();
	const event = makeFormEvent(u, { code: 'de' }, 'unmark');
	await expect(countryActions.unmark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/countries'
	});
	expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
});

test('autoMark action derives countries and states from past trips', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const t = makeTrip(kitDb(), u.id, {
		destinationCountryCode: 'US',
		destinationCityLat: 39.7392,
		destinationCityLng: -104.9903,
		status: 'completed'
	});
	makeSegment(kitDb(), t.id, {
		countryCode: 'US',
		cityLat: 41.8781,
		cityLng: -87.6298,
		startAt: '2020-01-01T00:00:00.000Z'
	});
	const event = makeFormEvent(u, {}, 'autoMark');
	await expect(countryActions.autoMark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/countries'
	});
	const stateCodes = kitDb()
		.selectFrom(visitedUsStates)
		.executeSync()
		.map((r) => r.state_code)
		.sort();
	expect(stateCodes).toEqual(['US-CO', 'US-IL']);
	expect(kitDb().selectFrom(visitedCountries).executeSync()[0]!.country_code).toBe('US');
});

test('clear action removes all countries', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb()
		.insertInto(visitedCountries)
		.values({ user_id: BigInt(u.id), country_code: 'FR', visited_on: null, source: 'manual' })
		.executeSync();
	const event = makeFormEvent(u, {}, 'clear');
	await expect(countryActions.clear(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/countries'
	});
	expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
});

test('toggleAutoMark action flips the user setting', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c', autoMarkVisited: false });
	const event = makeFormEvent(u, {}, 'toggleAutoMark');
	await expect(countryActions.toggleAutoMark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited/countries'
	});
	const row = kitDb().selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.auto_mark_visited).toBe(true);
	expect(event.cookies.set).toHaveBeenCalledWith('flash', 'Auto-mark enabled.', expect.any(Object));
});

test('mark rejects impossible first visited dates', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { code: 'de', firstVisitedOn: '2026-02-31' }, 'mark');
	const result = await countryActions.mark(event);
	expect(result).toMatchObject({ status: 400, data: { error: 'First visited must be a valid date.' } });
	expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
});

test('update rejects impossible last visited dates and leaves stored dates unchanged', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb()
		.insertInto(visitedCountries)
		.values({
			user_id: BigInt(u.id),
			country_code: 'DE',
			visited_on: '2023-01-01',
			first_visited_on: '2023-01-01',
			last_visited_on: '2023-06-01',
			source: 'manual'
		})
		.executeSync();
	const event = makeFormEvent(u, { code: 'de', lastVisitedOn: '2026-13-01' }, 'update');
	const result = await countryActions.update(event);
	expect(result).toMatchObject({ status: 400, data: { error: 'Last visited must be a valid date.' } });
	const row = kitDb().selectFrom(visitedCountries).executeSync()[0]!;
	expect(row.first_visited_on).toBe('2023-01-01');
	expect(row.last_visited_on).toBe('2023-06-01');
});

test('mark rejects impossible calendar dates and accepts real ones', async () => {
	for (const bad of ['2026-00-10', '2026-01-00', '2026-04-31', '2027-02-29']) {
		const u = makeUser(kitDb(), { email: `u-${bad}@x.c` });
		const event = makeFormEvent(u, { code: 'de', firstVisitedOn: bad }, 'mark');
		const result = await countryActions.mark(event);
		expect(result).toMatchObject({ status: 400, data: { error: 'First visited must be a valid date.' } });
		expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
	}
	const u = makeUser(kitDb(), { email: 'u-ok@x.c' });
	const okEvent = makeFormEvent(u, { code: 'de', firstVisitedOn: '2026-02-28' }, 'mark');
	await expect(countryActions.mark(okEvent)).rejects.toMatchObject({ status: 303 });
	expect(kitDb().selectFrom(visitedCountries).executeSync()[0]!.first_visited_on).toBe('2026-02-28');

	const u2 = makeUser(kitDb(), { email: 'u-ok2@x.c' });
	const okEvent2 = makeFormEvent(u2, { code: 'de', firstVisitedOn: '2028-02-29' }, 'mark');
	await expect(countryActions.mark(okEvent2)).rejects.toMatchObject({ status: 303 });
	const rows2 = kitDb().selectFrom(visitedCountries).executeSync();
	const row2 = rows2.find((r) => Number(r.user_id) === u2.id)!;
	expect(row2.first_visited_on).toBe('2028-02-29');
});

test('loadVisitedPage and mark use the user local today', async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-06-15T18:00:00Z'));
	try {
		const now = DateTime.now();
		const zone = 'Etc/GMT-14';
		const u = makeUser(kitDb(), { email: 'local@x.c', timezone: zone });
		const data = loadCountries({
			locals: makeLocals(u),
			url: new URL('http://localhost/profile/visited/countries')
		} as any) as any;
		const localToday = todayInTimezone(zone, now);
		expect(localToday).toBe('2026-06-16');
		expect(data.today).toBe(localToday);
		expect(data.today).not.toBe('2026-06-15');

		const event = makeFormEvent(u, { code: 'fr' }, 'mark');
		await expect(countryActions.mark(event)).rejects.toMatchObject({ status: 303 });
		const row = kitDb().selectFrom(visitedCountries).executeSync()[0]!;
		expect(row.first_visited_on).toBe(localToday);
		expect(row.last_visited_on).toBe(localToday);
	} finally {
		vi.useRealTimers();
	}
});

test('autoMarkFromTrip gates on the explicit today', () => {
	const u = makeUser(kitDb(), { email: 'auto@x.c' });
	const t = makeTrip(kitDb(), u.id, {
		destinationCountryCode: 'FR',
		status: 'planning',
		startDate: '2026-06-10'
	});
	expect(autoMarkFromTrip(u.id, t.id, '2026-06-10').countries).toEqual(['FR']);

	const u2 = makeUser(kitDb(), { email: 'auto2@x.c' });
	const t2 = makeTrip(kitDb(), u2.id, {
		destinationCountryCode: 'FR',
		status: 'planning',
		startDate: '2026-06-10'
	});
	expect(autoMarkFromTrip(u2.id, t2.id, '2026-06-09').countries).toEqual([]);
	expect(kitDb().selectFrom(visitedCountries).executeSync().filter((r) => Number(r.user_id) === u2.id)).toHaveLength(0);
});

test('autoMarkFromAllTrips passes the explicit today through to every owned trip', () => {
	const u = makeUser(kitDb(), { email: 'all@x.c' });
	makeTrip(kitDb(), u.id, {
		destinationCountryCode: 'FR',
		status: 'planning',
		startDate: '2026-06-10'
	});
	expect(autoMarkFromAllTrips(u.id, '2026-06-10').countries).toEqual(['FR']);

	// Same fixture with an explicit today one day earlier: nothing may be marked.
	// If the date were dropped, todayForUser would fall back to the real date and mark it.
	const u2 = makeUser(kitDb(), { email: 'all2@x.c' });
	makeTrip(kitDb(), u2.id, {
		destinationCountryCode: 'FR',
		status: 'planning',
		startDate: '2026-06-10'
	});
	expect(autoMarkFromAllTrips(u2.id, '2026-06-09').countries).toEqual([]);
	expect(kitDb().selectFrom(visitedCountries).executeSync().filter((r) => Number(r.user_id) === u2.id)).toHaveLength(0);
});
