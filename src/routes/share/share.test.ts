import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from '$lib/server/db';

import { makeUser, makeTrip, makeSegment } from '../../../tests/helpers';


import { _loadByToken as loadByToken, load } from './[token]/+page.server';
import { resetRateLimit } from '$lib/server/rateLimit';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';

test('valid token returns projection without sensitive data; bad token 404s', () => {
	const a = makeUser(kit, { email: 'a@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T', notes: 'SECRET', publicToken: 'tok123' });
	makeSegment(kit, t.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T00:00:00Z',
			startTz: 'UTC',
			confirmationNumber: 'CONF'
		});
	const data = loadByToken('tok123') as { trip: { segments: unknown[] } };
	expect(JSON.stringify(data)).not.toContain('SECRET');
	expect(JSON.stringify(data)).not.toContain('CONF');
	expect(() => loadByToken('nope')).toThrow();
});

test('load is rate limited after many requests from the same IP', () => {
	resetRateLimit();
	const a = makeUser(kit, { email: 'rl@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, { name: 'T', publicToken: 'rltok' });

	for (let i = 0; i < 20; i++) {
		load({ params: { token: 'rltok' }, getClientAddress: () => '1.2.3.4' } as any);
	}
	try {
		load({ params: { token: 'rltok' }, getClientAddress: () => '1.2.3.4' } as any);
		expect.fail('expected 429');
	} catch (e: any) {
		expect(e.status).toBe(429);
		expect(e.body?.message).toBe('Too many requests');
	}
});

test('rate limit does not block a different IP', () => {
	resetRateLimit();
	const a = makeUser(kit, { email: 'rl2@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, { name: 'T', publicToken: 'rltok2' });

	for (let i = 0; i < 20; i++) {
		load({ params: { token: 'rltok2' }, getClientAddress: () => '1.2.3.4' } as any);
	}
	const data = load({ params: { token: 'rltok2' }, getClientAddress: () => '5.6.7.8' } as any) as {
		trip: { name: string };
	};
	expect(data.trip.name).toBe('T');
});

test('expired public token returns 404', () => {
	resetRateLimit();
	const a = makeUser(kit, { email: 'exp@x.c', passwordHash: 'x', displayName: 'A' });
	makeTrip(kit, a.id, {
		name: 'T',
		publicToken: 'expired',
		publicTokenExpiresAt: '2020-01-01T00:00:00Z'
	});

	try {
		loadByToken('expired');
		expect.fail('expected 404');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('public link hides details by default and shows them when publicShowDetails is enabled', () => {
	const a = makeUser(kit, { email: 'pub-det@x.c', passwordHash: 'x', displayName: 'A' });
	const t = makeTrip(kit, a.id, { name: 'T', publicToken: 'det-hidden' });
	makeSegment(kit, t.id, {
			type: 'flight',
			title: 'UA1',
			startAt: '2026-07-01T00:00:00Z',
			startTz: 'UTC',
			confirmationNumber: 'CONF123',
			detailsJson: '{"seat":"12A"}'
		});

	const hidden = loadByToken('det-hidden') as { trip: { segments: unknown[] } };
	expect(JSON.stringify(hidden)).not.toContain('CONF123');
	expect(JSON.stringify(hidden)).not.toContain('12A');

	tripsRepo.updateTrip(t.id, { publicShowDetails: true });

	const visible = loadByToken('det-hidden') as { trip: { segments: unknown[] } };
	expect(JSON.stringify(visible)).toContain('CONF123');
	expect(JSON.stringify(visible)).toContain('12A');
});
