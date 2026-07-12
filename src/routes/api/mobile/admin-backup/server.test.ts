import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { POST } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { makeKitUser } from '../../../../../tests/kitHelpers';

test('mobile restore rejects requests without a backup file', async () => {
	const admin = makeKitUser({ id: 500n, email: 'backup@example.com', role: 'admin' });
	const response = await POST({
		locals: { user: validateOAuthUser(Number(admin.id)) }, getClientAddress: () => '127.0.0.1',
		request: new Request('https://roamarr.test/api/mobile/admin-backup', { method: 'POST', body: new FormData() })
	} as any);
	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({ error: 'Upload a file' });
});
