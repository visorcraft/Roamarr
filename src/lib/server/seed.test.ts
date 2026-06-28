import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { seedDemoData } from './seed';
import {
	users,
	trips,
	segments,
	cards,
	insurancePolicies,
	loyaltyPrograms
} from './db/mongrelSchema';
import {
	users as kitUsers,
	trips as kitTrips,
	segments as kitSegments,
	cards as kitCards,
	insurancePolicies as kitInsurancePolicies,
	loyaltyPrograms as kitLoyaltyPrograms
} from './db/mongrelSchema';
import { eq } from '@mongreldb/kit';
import * as usersRepo from './repositories/usersRepo';

function makeAdmin(email: string) {
	return usersRepo.createUser({
		email,
		password_hash: 'x',
		display_name: 'Admin',
		calendar_token: null,
		calendar_token_expires_at: null,
		role: 'admin'
	} as any);
}

beforeEach(() => {
	const db = (ctx as { db: import('./db').DB }).db;
	const kit = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit;
	db.delete(loyaltyPrograms).run();
	db.delete(insurancePolicies).run();
	db.delete(cards).run();
	db.delete(segments).run();
	db.delete(trips).run();
	db.delete(users).run();
	kit.deleteFrom(kitLoyaltyPrograms).executeSync();
	kit.deleteFrom(kitInsurancePolicies).executeSync();
	kit.deleteFrom(kitCards).executeSync();
	kit.deleteFrom(kitSegments).executeSync();
	kit.deleteFrom(kitTrips).executeSync();
	kit.deleteFrom(kitUsers).executeSync();
});

test('seedDemoData creates trips, segments and cards for the admin user', () => {
	const admin = makeAdmin('admin@x.c');

	seedDemoData(Number(admin.id));

	expect((ctx as { db: import('./db').DB }).db.select().from(trips).all().length).toBeGreaterThan(0);
	expect((ctx as { db: import('./db').DB }).db.select().from(segments).all().length).toBeGreaterThan(0);
	expect((ctx as { db: import('./db').DB }).db.select().from(cards).all().length).toBeGreaterThan(0);
	expect((ctx as { db: import('./db').DB }).db.select().from(insurancePolicies).all().length).toBeGreaterThan(0);
	expect((ctx as { db: import('./db').DB }).db.select().from(loyaltyPrograms).all().length).toBeGreaterThan(0);
});

test('seedDemoData removes existing non-admin data', () => {
	const admin = makeAdmin('admin2@x.c');
	const other = usersRepo.createUser({
		email: 'other@x.c',
		password_hash: 'x',
		display_name: 'O',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	const otherTrip = (ctx as { db: import('./db').DB }).db
		.insert(trips)
		.values({ ownerId: Number(other.id), name: 'Other Trip' })
		.returning()
		.get();

	seedDemoData(Number(admin.id));

	const db = (ctx as { db: import('./db').DB }).db;
	expect(db.select().from(users).where(eq(users.id, BigInt(other.id))).get()).toBeUndefined();
	expect(db.select().from(trips).where(eq(trips.owner_id, BigInt(other.id))).get()).toBeUndefined();
	expect(db.select().from(users).where(eq(users.id, BigInt(admin.id))).get()).toBeDefined();
});
