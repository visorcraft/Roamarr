import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { load } from './+page.server';
import { makeAdminLocals, makeUserLocals } from '../../../tests/eventHelpers';

test('load returns empty shape for admin', () => {
	const admin = makeAdminLocals((ctx as any).kit);
	const result = load({ locals: admin } as any);
	expect(result).toEqual({});
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
