import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load, actions } from './+page.server';
import { schedulerRuns, users } from '$lib/server/db/mongrelSchema';

import { beforeEach } from 'vitest';
import { makeAdminLocals, makeUserLocals } from '../../../tests/eventHelpers';

beforeEach(() => {
	(ctx as any).kit.deleteFrom(schedulerRuns).executeSync();
	(ctx as any).kit.deleteFrom(users).executeSync();
});

test('load rejects non-admin', () => {
	const u = makeUserLocals((ctx as any).kit);
	try {
		load({ locals: u } as any);
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
});

test('load returns empty shape for admin', () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const result = load({ locals: admin } as any);
	expect(result).toEqual({});
});

test('runNow action triggers a scheduler tick and redirects', async () => {
	const kit = (ctx as any).kit;
	const admin = makeAdminLocals(kit);
	const before = kit.selectFrom(schedulerRuns).selectCount().executeSync();
	await expect(actions.runNow({ locals: admin } as any)).rejects.toMatchObject({
		status: 303,
		location: '/jobs'
	});
	const after = kit.selectFrom(schedulerRuns).selectCount().executeSync();
	expect(after).toBeGreaterThan(before);
});
