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
import { getUserById } from '$lib/server/repositories/usersRepo';

const post = (user: ReturnType<typeof validateOAuthUser>, body: unknown) =>
	POST({
		locals: { user },
		url: new URL('https://roamarr.test/api/mobile/calendar'),
		request: new Request('https://roamarr.test/api/mobile/calendar', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	} as any) as Promise<Response>;

test('mobile calendar POST rejects a malformed expiry', async () => {
	const row = makeKitUser({ email: 'cal-bad@example.com', calendar_token: 'old-token-malformed' });
	const user = validateOAuthUser(Number(row.id));
	const res = await post(user, { expiresAt: 'banana' });
	expect(res.status).toBe(400);
	expect(await res.json()).toEqual({ error: 'Calendar feed expiry must be a valid date.' });
	expect(getUserById(Number(row.id))?.calendar_token).toBe('old-token-malformed');
});

test('mobile calendar POST rejects a past expiry', async () => {
	const row = makeKitUser({ email: 'cal-past@example.com', calendar_token: 'old-token-past' });
	const user = validateOAuthUser(Number(row.id));
	const res = await post(user, { expiresAt: '2000-01-01' });
	expect(res.status).toBe(400);
	expect(await res.json()).toEqual({ error: 'Calendar feed expiry must be in the future.' });
	expect(getUserById(Number(row.id))?.calendar_token).toBe('old-token-past');
});

test('mobile calendar POST accepts a valid expiry', async () => {
	const row = makeKitUser({ email: 'cal-ok@example.com' });
	const user = validateOAuthUser(Number(row.id));
	const res = await post(user, { expiresAt: '2030-01-01T00:00:00Z' });
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.expiresAt).toBe('2030-01-01T00:00:00Z');
	expect(getUserById(Number(row.id))?.calendar_token_expires_at).toBe('2030-01-01T00:00:00Z');
});

test('mobile calendar POST validates date-only expiry against UTC midnight to match isExpired', async () => {
	const row = makeKitUser({ email: 'cal-utc@example.com', calendar_token: 'old-token-utc' });
	const user = validateOAuthUser(Number(row.id));
	vi.useFakeTimers();
	try {
		// 2026-11-24T02:00:00Z is already past 2026-11-24T00:00:00Z even on UTC-negative servers.
		vi.setSystemTime(new Date('2026-11-24T02:00:00Z'));
		const res = await post(user, { expiresAt: '2026-11-24' });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Calendar feed expiry must be in the future.' });
		expect(getUserById(Number(row.id))?.calendar_token).toBe('old-token-utc');
	} finally {
		vi.useRealTimers();
	}
});
