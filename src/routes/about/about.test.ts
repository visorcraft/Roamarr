import { beforeEach, expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import * as segmentsRepo from '$lib/server/repositories/segmentsRepo';
import {
	users as kitUsers,
	trips as kitTrips,
	segments as kitSegments,
	groups as kitGroups,
	notifications as kitNotifications
} from '$lib/server/db/mongrelSchema';

beforeEach(() => {
	const kit = (ctx as any).kit;
	kit.deleteFrom(kitNotifications).executeSync();
	kit.deleteFrom(kitGroups).executeSync();
	kit.deleteFrom(kitSegments).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

test('load returns app info and hides admin-only details for regular users', () => {
	const user = usersRepo.createUser({
		email: 'user@x.c',
		password_hash: 'x',
		display_name: 'User',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	const result = load({ locals: { user: { id: Number(user.id), role: 'user' } } } as any) as {
		app: { name: string; version: string };
		isAdmin: boolean;
		databasePath: string | null;
		stats: unknown;
	};

	expect(result.app.name).toBe('Roamarr');
	expect(result.app.version).toMatch(/^\d+\.\d+\.\d+/);
	expect(result.isAdmin).toBe(false);
	expect(result.databasePath).toBeNull();
	expect(result.stats).toBeNull();
});

test('load includes instance stats for admins', () => {
	const admin = usersRepo.createUser({
		email: 'admin@x.c',
		password_hash: 'x',
		display_name: 'Admin',
		role: 'admin',
		calendar_token: null,
		calendar_token_expires_at: null
	} as any);
	const trip = tripsRepo.createTrip(Number(admin.id), { name: 'T' });
	segmentsRepo.createSegment({
		trip_id: BigInt(trip.id),
		type: 'flight',
		title: 'Segment',
		start_at: new Date().toISOString()
	} as any);

	const result = load({ locals: { user: { id: Number(admin.id), role: 'admin' } } } as any) as {
		isAdmin: boolean;
		databasePath: string | null;
		stats: { users: number; trips: number; segments: number };
	};

	expect(result.isAdmin).toBe(true);
	expect(result.databasePath).toBe('./roamarr-test-db');
	expect(result.stats).toMatchObject({ users: 1, trips: 1, segments: 1 });
});
