import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
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

import { DELETE } from './+server';
import { travelDocuments, auditLogs, tripCompanions, trips, users, reminders } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { makeUser } from '../../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';
import { addDocument } from '$lib/server/travelDocuments';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete removes an owned document + its reminders, logs audit, returns 204', async () => {
	const user = makeUser(ctx.kit, { email: 'owner@x.c' });
	const doc = addDocument(user.id, { type: 'passport', expiresOn: '2030-01-01' });
	// Reminder armed by addDocument; delete should cancel it.
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(1);

	const res = await DELETE(makeEvent({ id: String(doc.id) }, user));
	expect(res.status).toBe(204);
	expect(kit.selectFrom(travelDocuments).executeSync()).toHaveLength(0);
	expect(kit.selectFrom(reminders).executeSync()).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	expect(logs).toHaveLength(1);
	expect(logs[0].action).toBe('document_delete');
	expect(logs[0].entity_type).toBe('document');
});

test('delete returns 404 for another users document', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const doc = addDocument(owner.id, { type: 'passport' });

	await expect(DELETE(makeEvent({ id: String(doc.id) }, other))).rejects.toMatchObject({ status: 404 });
	expect(kit.selectFrom(travelDocuments).executeSync()).toHaveLength(1);
});

test('delete rejects unauthenticated request', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});
