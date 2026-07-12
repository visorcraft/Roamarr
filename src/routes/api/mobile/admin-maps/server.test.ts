import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, POST } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { getSettings, updateSettings } from '$lib/server/settings';
import { makeKitUser } from '../../../../../tests/kitHelpers';

test('mobile map admin reports status and disables maps', async () => {
	const admin = makeKitUser({ id: 700n, email: 'maps@example.com', role: 'admin' }), user = validateOAuthUser(Number(admin.id));
	updateSettings({ mapsEnabled: true });
	const read = GET({ locals: { user } } as any) as Response;
	expect(await read.json()).toHaveProperty('cityCount');
	const response = await POST({ locals: { user }, url: new URL('https://roamarr.test/api/mobile/admin-maps?action=disableMaps'), cookies: { set: vi.fn() }, getClientAddress: () => '127.0.0.1', request: new Request('https://roamarr.test/api/mobile/admin-maps?action=disableMaps', { method: 'POST' }) } as any);
	expect(response.status).toBe(200);
	expect(getSettings().mapsEnabled).toBe(false);
});
