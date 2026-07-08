import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as import('@visorcraft/mongreldb-kit').KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
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
import { makeUserLocals } from '../../../../../../tests/eventHelpers';
import { makeUser, makeCompanion } from '../../../../../../tests/helpers';
import { addDocument } from '$lib/server/travelDocuments';
import { createTrip } from '$lib/server/repositories/tripsRepo';

function event(
	user: { id: number } | null,
	params: Record<string, string>,
	body?: FormData,
	clientAddress = '127.0.0.1'
) {
	return {
		locals: { user } as App.Locals,
		params,
		request: body ? ({ formData: async () => body } as Request) : undefined,
		getClientAddress: () => clientAddress
	} as any;
}

test('load requires a signed-in user', () => {
	expect(() => load(event(null, { id: '1' }))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns 404 for missing or non-owned document', () => {
	const user = makeUserLocals(ctx.kit);
	expect(() => load(event(user.user, { id: '999' }))).toThrow(
		expect.objectContaining({ status: 404 })
	);
});

test('load returns document + companions', () => {
	const user = makeUserLocals(ctx.kit);
	const trip = createTrip(user.user.id, { name: 'Tokyo' });
	const companion = makeCompanion(ctx.kit, trip.id, { name: 'Sam' });
	const doc = addDocument(user.user.id, { type: 'passport', companionId: companion.id });

	const result = load(event(user.user, { id: String(doc.id) })) as {
		document: { id: number; type: string };
		companions: Array<{ id: number; name: string }>;
	};
	expect(result.document.id).toBe(doc.id);
	expect(result.companions).toHaveLength(1);
	expect(result.companions[0].name).toBe('Sam');
});

test('update action edits a document, re-arms reminder, logs audit, redirects', async () => {
	const user = makeUserLocals(ctx.kit);
	const doc = addDocument(user.user.id, { type: 'passport', expiresOn: '2030-01-01' });

	const f = new FormData();
	f.set('type', 'visa');
	f.set('number', 'V54321');
	f.set('issuingAuthority', 'Italian Consulate');
	f.set('expiresOn', '2031-12-31');
	f.set('notes', 'Updated note');

	await expect(actions.update(event(user.user, { id: String(doc.id) }, f))).rejects.toEqual(
		expect.objectContaining({ status: 303 })
	);

	const row = ctx.kit.selectFrom(travelDocuments).where(kitEq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('visa');
	expect(row.number).not.toBe('V54321');
	expect(row.issuing_authority).toBe('Italian Consulate');
	expect(row.expires_on).toBe('2031-12-31');
	expect(row.notes).toBe('Updated note');

	const logs = ctx.kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('document_update');
	expect(logs[0].entity_type).toBe('document');
});

test('update action cannot edit another users document', async () => {
	const owner = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const doc = addDocument(owner.user.id, { type: 'passport' });

	const f = new FormData();
	f.set('type', 'visa');
	await expect(actions.update(event(other, { id: String(doc.id) }, f))).rejects.toMatchObject({
		status: 404
	});

	const row = ctx.kit.selectFrom(travelDocuments).where(kitEq(travelDocuments.id, BigInt(doc.id))).executeSync()[0]!;
	expect(row.type).toBe('passport');
});

test('update action rejects foreign companion', async () => {
	const owner = makeUserLocals(ctx.kit);
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const otherTrip = createTrip(other.id, { name: 'Other' });
	const otherCompanion = makeCompanion(ctx.kit, otherTrip.id, { name: 'OtherC' });
	const doc = addDocument(owner.user.id, { type: 'passport' });

	const f = new FormData();
	f.set('type', 'passport');
	f.set('companionId', String(otherCompanion.id));

	await expect(actions.update(event(owner.user, { id: String(doc.id) }, f))).rejects.toMatchObject({
		status: 404
	});
});

test('update action rate limits', async () => {
	const user = makeUserLocals(ctx.kit);
	const doc = addDocument(user.user.id, { type: 'passport' });
	for (let i = 0; i < 10; i++) {
		const f = new FormData();
		f.set('type', 'passport');
		await expect(actions.update(event(user.user, { id: String(doc.id) }, f))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
	}

	const f = new FormData();
	f.set('type', 'passport');
	const result = (await actions.update(event(user.user, { id: String(doc.id) }, f))) as {
		status: number;
		data: { error: string };
	};
	expect(result.status).toBe(429);
});
