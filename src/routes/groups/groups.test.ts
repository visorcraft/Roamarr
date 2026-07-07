import { test, expect, vi, beforeEach, afterAll } from 'vitest';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { resetRateLimit } from '$lib/server/rateLimit';

const ctx = vi.hoisted(() => ({
	kit: null as unknown as KitDatabase,
	close: null as unknown as () => void
}));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	const { kit, close } = freshDb();
	Object.assign(ctx, { kit, close });
	return { kit, getDb: () => kit };
});

beforeEach(() => {
	ctx.kit.deleteFrom(groupMembers).executeSync();
	ctx.kit.deleteFrom(groups).executeSync();
	ctx.kit.deleteFrom(users).executeSync();
	resetRateLimit();
});

afterAll(() => {
	ctx.close();
});

import { load } from './+page.server';
import { groupMembers, groups, users } from '$lib/server/db/mongrelSchema';
import { makeUserLocals } from '../../../tests/eventHelpers';

function event(user: { id: number } | null) {
	return {
		locals: { user } as App.Locals
	} as any;
}

test('load rejects non-user', () => {
	expect(() => load(event(null))).toThrow(expect.objectContaining({ status: 401 }));
});

test('load returns empty shape for user', () => {
	const user = makeUserLocals(ctx.kit);
	const result = load(event(user.user));
	expect(result).toEqual({});
});
