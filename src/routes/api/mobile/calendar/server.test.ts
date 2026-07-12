import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, POST } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { makeKitUser } from '../../../../../tests/kitHelpers';

test('mobile user calendar generates and returns private feed URL', async () => {
	const row = makeKitUser({ email: 'calendar@example.com', display_name: 'Calendar' });
	const user = validateOAuthUser(Number(row.id));
	const before = await GET({ locals: { user }, url: new URL('https://roamarr.test/api/mobile/calendar') } as any) as Response;
	expect((await before.json()).feedUrl).toBeNull();
	const created = await POST({ locals: { user }, url: new URL('https://roamarr.test/api/mobile/calendar'), request: new Request('https://roamarr.test/api/mobile/calendar', { method: 'POST', body: JSON.stringify({ expiresAt: '2027-01-01T00:00:00Z' }) }) } as any) as Response;
	const body = await created.json();
	expect(body.feedUrl).toMatch(/^https:\/\/roamarr\.test\/calendar\/feed\?token=/);
	expect(body.expiresAt).toBe('2027-01-01T00:00:00Z');
});
