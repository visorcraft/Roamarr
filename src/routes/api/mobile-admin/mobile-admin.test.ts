import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, POST } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { makeKitUser } from '../../../../tests/kitHelpers';

test('admin endpoint rejects ordinary users and strips credential fields', async () => {
	const ordinary = makeKitUser({ email: 'user@example.com', password_hash: 'secret', display_name: 'User' });
	expect(() => GET({ locals: { user: validateOAuthUser(Number(ordinary.id)) } } as any)).toThrow();
	const admin = makeKitUser({ email: 'admin@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const response = GET({ locals: { user: validateOAuthUser(Number(admin.id)) } } as any) as Response;
	const body = await response.json();
	expect(body.users).toHaveLength(2);
	expect(body.users[0]).not.toHaveProperty('passwordHash');
	expect(JSON.stringify(body)).not.toContain('secret');
});

test('admin can create a user through the mobile endpoint', async () => {
	const admin = makeKitUser({ email: 'admin2@example.com', password_hash: 'secret', display_name: 'Admin', role: 'admin' });
	const response = await POST({
		locals: { user: validateOAuthUser(Number(admin.id)) }, url: new URL('https://roamarr.example/api/mobile-admin'),
		request: new Request('https://roamarr.example/api/mobile-admin', { method: 'POST', body: JSON.stringify({ action: 'create', email: 'new@example.com', displayName: 'New' }) })
	} as any) as Response;
	expect(response.status).toBe(201);
	expect(await response.json()).toHaveProperty('temporaryPassword');
});
