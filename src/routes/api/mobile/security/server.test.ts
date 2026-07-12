import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { POST } from './+server';
import { hashPassword, validateOAuthUser } from '$lib/server/auth';
import { getUserById } from '$lib/server/repositories/usersRepo';
import { makeKitUser } from '../../../../../tests/kitHelpers';

test('mobile security changes email only with password and matching address', async () => {
	const row = makeKitUser({ email: 'old@example.com', password_hash: await hashPassword('correct-password'), display_name: 'User' });
	const user = validateOAuthUser(Number(row.id));
	await expect(POST({ locals: { user }, request: new Request('https://roamarr.test/api/mobile/security', { method: 'POST', body: JSON.stringify({ action: 'email', currentPassword: 'wrong', newEmail: 'new@example.com', confirmEmail: 'new@example.com' }) }) } as any)).rejects.toThrow();
	const good = await POST({ locals: { user }, request: new Request('https://roamarr.test/api/mobile/security', { method: 'POST', body: JSON.stringify({ action: 'email', currentPassword: 'correct-password', newEmail: 'new@example.com', confirmEmail: 'new@example.com' }) }) } as any) as Response;
	expect(good.status).toBe(200);
	expect(getUserById(Number(row.id))?.email).toBe('new@example.com');
});
