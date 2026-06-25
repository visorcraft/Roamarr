import { beforeEach, expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { makeSegment, makeTrip, makeUser } from '../../../../tests/helpers';
import { load } from './+page.server';

beforeEach(() => {
	(ctx as any).sqlite.exec('delete from users; delete from trips; delete from segments; delete from groups; delete from notifications;');
});

test('load returns app info and hides admin-only details for regular users', () => {
	const user = makeUser((ctx as any).db, { role: 'user' });
	const result = load({ locals: { user } } as any) as {
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
	const db = (ctx as any).db;
	const admin = makeUser(db, { role: 'admin' });
	const trip = makeTrip(db, { ownerId: admin.id });
	makeSegment(db, { tripId: trip.id });

	const result = load({ locals: { user: admin } } as any) as {
		isAdmin: boolean;
		databasePath: string | null;
		stats: { users: number; trips: number; segments: number };
	};

	expect(result.isAdmin).toBe(true);
	expect(result.databasePath).toBe(':memory:');
	expect(result.stats).toMatchObject({ users: 1, trips: 1, segments: 1 });
});
