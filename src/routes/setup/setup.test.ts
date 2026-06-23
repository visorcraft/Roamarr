import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { _createAdmin as createAdmin } from './+page.server';
import { users } from '$lib/server/db/schema';

test('creates exactly one admin; second attempt rejected', () => {
	createAdmin({
		email: 'Admin@X.com ',
		password: 'correcthorse',
		displayName: 'Admin',
		instanceName: 'R',
		timezone: 'UTC'
	});
	const all = (ctx as any).db.select().from(users).all();
	expect(all.length).toBe(1);
	expect(all[0].role).toBe('admin');
	expect(all[0].email).toBe('admin@x.com');
	expect(() =>
		createAdmin({
			email: 'b@x.com',
			password: 'correcthorse',
			displayName: 'B',
			instanceName: 'R',
			timezone: 'UTC'
		})
	).toThrow(/already/i);
});
