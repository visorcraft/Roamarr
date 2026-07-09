import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(reminders).executeSync();
	ctx.kit.deleteFrom(travelDocuments).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(tripCompanions).executeSync();
	ctx.kit.deleteFrom(trips).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load, actions } from './+page.server';
import {
	travelDocuments,
	auditLogs,
	tripCompanions,
	trips,
	users,
	reminders
} from '$lib/server/db/mongrelSchema';
import { eq as kitEq } from '@visorcraft/mongreldb-kit';
import { makeUserLocals } from '../../../../../tests/eventHelpers';
import { makeUser, makeCompanion } from '../../../../../tests/helpers';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function event(user: { id: number } | null, body?: FormData, clientAddress = '127.0.0.1') {
	return {
		locals: { user } as App.Locals,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns companions for owned trips', () => {
	const user = makeUserLocals(ctx.kit);
	const trip = createTrip(user.user.id, { name: 'Tokyo' });
	makeCompanion(ctx.kit, trip.id, { name: 'Sam' });

	const result = load(event(user.user)) as { companions: Array<{ id: number; name: string }> };
	expect(result.companions).toHaveLength(1);
	expect(result.companions[0].name).toBe('Sam');
});

test('create action adds a document, encrypts number, arms reminder, logs audit, redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('type', 'passport');
	f.set('number', 'P12345');
	f.set('issuingAuthority', 'US State Dept');
	f.set('expiresOn', '2030-01-01');

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(travelDocuments).where(kitEq(travelDocuments.user_id, BigInt(user.user.id))).executeSync();
	expect(rows).toHaveLength(1);
	expect(rows[0].type).toBe('passport');
	expect(rows[0].number).not.toBe('P12345');
	expect(rows[0].expires_on).toBe('2030-01-01');

	const remRows = ctx.kit.selectFrom(reminders).executeSync();
	expect(remRows).toHaveLength(1);
	expect(remRows[0].kind).toBe('document_expiry');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('document_create');
	expect(logs[0].entity_type).toBe('document');
});

test('create action links an owned companion', async () => {
	const user = makeUserLocals(ctx.kit);
	const trip = createTrip(user.user.id, { name: 'Rome' });
	const companion = makeCompanion(ctx.kit, trip.id, { name: 'Riley' });

	const f = new FormData();
	f.set('type', 'passport');
	f.set('companionId', String(companion.id));

	await expect(actions.create(event(user.user, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const rows = ctx.kit.selectFrom(travelDocuments).executeSync();
	expect(rows).toHaveLength(1);
	expect(Number(rows[0].companion_id)).toBe(companion.id);
});

test('create action rejects foreign companion', async () => {
	const owner = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const otherTrip = createTrip(other.id, { name: 'Other' });
	const otherCompanion = makeCompanion(ctx.kit, otherTrip.id, { name: 'OtherC' });

	const f = new FormData();
	f.set('type', 'passport');
	f.set('companionId', String(otherCompanion.id));

	await expect(actions.create(event(owner.user, f))).rejects.toMatchObject({ status: 404 });
	expect(ctx.kit.selectFrom(travelDocuments).executeSync()).toHaveLength(0);
});

test('create action rejects invalid type', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('type', 'not_a_type');

	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.type).toContain('passport');
	expect(ctx.kit.selectFrom(travelDocuments).executeSync()).toHaveLength(0);
});

test('create action rejects bad companionId', async () => {
	const user = makeUserLocals(ctx.kit);
	const f = new FormData();
	f.set('type', 'passport');
	f.set('companionId', 'not-a-number');

	const result = (await actions.create(event(user.user, f))) as { status: number };
	expect(result.status).toBe(400);
});

test('create action rate limits', async () => {
	const user = makeUserLocals(ctx.kit);
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('type', 'passport');
		await expect(actions.create(event(user.user, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('type', 'passport');
	const result = (await actions.create(event(user.user, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
});
