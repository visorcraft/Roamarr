import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions, load } from './+page.server';
import { users, visitedCountries, visitedUsStates, trips, segments } from '$lib/server/db/mongrelSchema';
import { makeUser, makeTrip, makeSegment } from '../../../../tests/helpers';
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
	ip = '1.2.3.4'
) {
	const form = new FormData();
	for (const [k, v] of Object.entries(record)) form.set(k, v);
	return {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		getClientAddress: () => ip,
		request: new Request(`http://localhost/profile/visited?/${action}`, {
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

test('load returns empty lists and auto-mark flag without side effects', () => {
	const u = makeUser(kitDb(), { email: 'u@x.c', autoMarkVisited: true });
	const t = makeTrip(kitDb(), u.id, {
		destinationCountryCode: 'FR',
		status: 'completed'
	});
	const data = load({ locals: makeLocals({ id: u.id, role: u.role, autoMarkVisited: true }) } as any) as any;
	expect(data.countries).toEqual([]);
	expect(data.usStates).toEqual([]);
	expect(data.autoMarkVisited).toBe(true);
	expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
	expect(kitDb().selectFrom(visitedUsStates).executeSync()).toHaveLength(0);
	expect(kitDb().selectFrom(trips).where(eq(trips.id, BigInt(t.id))).executeSync()).toHaveLength(1);
});

test('mark action persists a country and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { kind: 'country', code: 'jp' }, 'mark');
	await expect(actions.mark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	expect(event.cookies.set).toHaveBeenCalledWith('flash', 'Marked JP as visited.', expect.any(Object));
	expect(kitDb().selectFrom(visitedCountries).executeSync()[0]!.country_code).toBe('JP');
});

test('mark action persists a US state and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { kind: 'state', code: 'ca' }, 'mark');
	await expect(actions.mark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	expect(kitDb().selectFrom(visitedUsStates).executeSync()[0]!.state_code).toBe('US-CA');
});

test('unmark action removes a place and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb().insertInto(visitedCountries).values({
		user_id: BigInt(u.id),
		country_code: 'DE',
		visited_on: null,
		source: 'manual'
	}).executeSync();
	const event = makeFormEvent(u, { kind: 'country', code: 'de' }, 'unmark');
	await expect(actions.unmark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
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
	const event = {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		request: new Request('http://localhost/profile/visited?/autoMark', { method: 'POST' })
	} as any;
	await expect(actions.autoMark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	const stateCodes = kitDb()
		.selectFrom(visitedUsStates)
		.executeSync()
		.map((r) => r.state_code)
		.sort();
	expect(stateCodes).toEqual(['US-CO', 'US-IL']);
	expect(kitDb().selectFrom(visitedCountries).executeSync()[0]!.country_code).toBe('US');
});

test('clear action removes all of the selected kind', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb().insertInto(visitedCountries).values({
		user_id: BigInt(u.id),
		country_code: 'FR',
		visited_on: null,
		source: 'manual'
	}).executeSync();
	const event = makeFormEvent(u, { kind: 'country' }, 'clear');
	await expect(actions.clear(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	expect(kitDb().selectFrom(visitedCountries).executeSync()).toHaveLength(0);
});

test('mark action uses submitted visited_on date', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { kind: 'country', code: 'jp', visited_on: '2022-07-15' }, 'mark');
	await expect(actions.mark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	const row = kitDb().selectFrom(visitedCountries).executeSync()[0]!;
	expect(row.country_code).toBe('JP');
	expect(row.visited_on).toBe('2022-07-15');
});

test('mark action defaults visited_on to today when omitted', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	const event = makeFormEvent(u, { kind: 'country', code: 'de' }, 'mark');
	await expect(actions.mark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	const row = kitDb().selectFrom(visitedCountries).executeSync()[0]!;
	expect(row.country_code).toBe('DE');
	expect(row.visited_on).toBe(new Date().toISOString().slice(0, 10));
});

test('load includes country visit summaries', () => {
	const u = makeUser(kitDb(), { email: 'u@x.c' });
	kitDb().insertInto(visitedCountries).values({
		user_id: BigInt(u.id),
		country_code: 'FR',
		visited_on: '2023-06-01',
		source: 'manual'
	}).executeSync();
	makeTrip(kitDb(), u.id, {
		destinationCountryCode: 'FR',
		startDate: '2024-02-10',
		endDate: '2024-02-20',
		status: 'completed'
	});
	const data = load({ locals: makeLocals(u) } as any) as any;
	expect(data.summaries).toEqual([
		{ code: 'FR', firstAt: '2023-06-01', lastAt: '2024-02-20', tripCount: 1 }
	]);
});

test('toggleAutoMark action flips the user setting and redirects', async () => {
	const u = makeUser(kitDb(), { email: 'u@x.c', autoMarkVisited: false });
	const event = {
		locals: makeLocals(u),
		cookies: { set: vi.fn(), get: vi.fn() },
		request: new Request('http://localhost/profile/visited?/toggleAutoMark', { method: 'POST' })
	} as any;
	await expect(actions.toggleAutoMark(event)).rejects.toMatchObject({
		status: 303,
		location: '/profile/visited'
	});
	const row = kitDb().selectFrom(users).where(eq(users.id, BigInt(u.id))).executeSync()[0]!;
	expect(row.auto_mark_visited).toBe(true);
	expect(event.cookies.set).toHaveBeenCalledWith('flash', 'Auto-mark enabled.', expect.any(Object));
});
