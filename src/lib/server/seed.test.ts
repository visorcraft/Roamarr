import { test, expect, vi, beforeEach } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
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
import { eq, type KitDatabase } from '@mongreldb/kit';
import * as usersRepo from './repositories/usersRepo';

function kitDb(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

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
	const kit = kitDb();
	kit.deleteFrom(loyaltyPrograms).executeSync();
	kit.deleteFrom(insurancePolicies).executeSync();
	kit.deleteFrom(cards).executeSync();
	kit.deleteFrom(segments).executeSync();
	kit.deleteFrom(trips).executeSync();
	kit.deleteFrom(users).executeSync();
});

test('seedDemoData creates trips, segments and cards for the admin user', () => {
	const kit = kitDb();
	const admin = makeAdmin('admin@x.c');

	seedDemoData(Number(admin.id));

	expect(kit.selectFrom(trips).executeSync().length).toBeGreaterThan(0);
	expect(kit.selectFrom(segments).executeSync().length).toBeGreaterThan(0);
	expect(kit.selectFrom(cards).executeSync().length).toBeGreaterThan(0);
	expect(kit.selectFrom(insurancePolicies).executeSync().length).toBeGreaterThan(0);
	expect(kit.selectFrom(loyaltyPrograms).executeSync().length).toBeGreaterThan(0);
});

test('seedDemoData removes existing non-admin data', () => {
	const kit = kitDb();
	const admin = makeAdmin('admin2@x.c');
	const other = usersRepo.createUser({
		email: 'other@x.c',
		password_hash: 'x',
		display_name: 'O',
		calendar_token: null,
		calendar_token_expires_at: null
	});
	kit.insertInto(trips).values({ owner_id: BigInt(other.id), name: 'Other Trip' }).executeSync();

	seedDemoData(Number(admin.id));

	expect(kit.selectFrom(users).where(eq(users.id, BigInt(other.id))).executeSync()[0]).toBeUndefined();
	expect(
		kit.selectFrom(trips).where(eq(trips.owner_id, BigInt(other.id))).executeSync()[0]
	).toBeUndefined();
	expect(kit.selectFrom(users).where(eq(users.id, BigInt(admin.id))).executeSync()[0]).toBeDefined();
});
