import { test, expect, vi, beforeEach } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';

const ctx = vi.hoisted(() => ({ kit: null as unknown as KitDatabase }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

beforeEach(() => {
	ctx.kit.deleteFrom(loyaltyPrograms).executeSync();
	ctx.kit.deleteFrom(auditLogs).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

import { DELETE } from './+server';
import { loyaltyPrograms, auditLogs, users } from '$lib/server/db/mongrelSchema';
import { kit } from '$lib/server/db';
import { makeUser } from '../../../../../tests/helpers';
import { resetRateLimit } from '$lib/server/rateLimit';
import { createLoyaltyProgram } from '$lib/server/repositories/profileRepo';

function makeEvent(params: Record<string, string>, user: unknown) {
	return {
		params,
		locals: { user },
		getClientAddress: () => '127.0.0.1'
	} as any;
}

test('delete removes an owned program, logs audit, and returns 204', async () => {
	const user = makeUser(ctx.kit, { email: 'owner@x.c' });
	const program = createLoyaltyProgram(user.id, { programName: 'United' });

	const res = await DELETE(makeEvent({ id: String(program.id) }, user));
	expect(res.status).toBe(204);
	expect(kit.selectFrom(loyaltyPrograms).executeSync()).toHaveLength(0);

	const logs = kit.selectFrom(auditLogs).executeSync();
	// create + delete
	expect(logs.some((l) => l.action === 'loyalty_program_delete' && Number(l.entity_id) === program.id)).toBe(true);
});

test('delete returns 404 for another users program', async () => {
	const owner = makeUser(ctx.kit, { email: 'owner@x.c' });
	const other = makeUser(ctx.kit, { email: 'other@x.c' });
	const program = createLoyaltyProgram(owner.id, { programName: 'United' });

	await expect(DELETE(makeEvent({ id: String(program.id) }, other))).rejects.toMatchObject({ status: 404 });
	expect(kit.selectFrom(loyaltyPrograms).executeSync()).toHaveLength(1);
});

test('delete rejects unauthenticated request', async () => {
	await expect(DELETE(makeEvent({ id: '1' }, null))).rejects.toMatchObject({ status: 401 });
});
