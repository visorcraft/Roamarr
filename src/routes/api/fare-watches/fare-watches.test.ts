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
import { makeTrip, makeFareProvider } from '../../../../tests/helpers';

test('mobile fare endpoint lists and creates only owned watches', async () => {
	const row = makeKitUser({ email: 'fare@example.com', password_hash: 'secret', display_name: 'Fare' });
	const user = validateOAuthUser(Number(row.id))!;
	const trip = makeTrip(ctx.kit, user.id);
	const provider = makeFareProvider(ctx.kit, user.id);
	const created = await POST({
		locals: { user }, getClientAddress: () => '127.0.0.1',
		request: new Request('http://x/api/fare-watches', { method: 'POST', body: JSON.stringify({ action: 'create', tripId: trip.id, providerId: provider.id }) })
	} as any) as Response;
	expect(created.status).toBe(201);
	const response = GET({ locals: { user } } as any) as Response;
	const body = await response.json();
	expect(body.rows).toHaveLength(1);
	expect(body.providers[0]).not.toHaveProperty('apiKey');
	expect(body.rows[0]).not.toHaveProperty('lastResultJson');
});
