import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, POST } from './+server';
import { validateOAuthUser } from '$lib/server/auth';
import { makeKitUser } from '../../../../../../../tests/kitHelpers';
import { createShare, createTrip, getShareById } from '$lib/server/repositories/tripsRepo';

test('mobile sharing manages expiring public and calendar links', async () => {
	const row = makeKitUser({ email: 'share@example.com', display_name: 'Share' }), user = validateOAuthUser(Number(row.id))!;
	const trip = createTrip(user.id, { name: 'Shared trip' });
	const call = (action: string, values = {}) => POST({ locals: { user }, params: { id: String(trip.id) }, url: new URL(`https://roamarr.test/api/mobile/trips/${trip.id}/sharing`), request: new Request('https://roamarr.test', { method: 'POST', body: JSON.stringify({ action, ...values }) }) } as any);
	await call('make-public', { showDetails: true, expiresAt: '2027-01-01T00:00:00Z' });
	await call('regenerate-calendar', { expiresAt: '2027-02-01T00:00:00Z' });
	const response = await GET({ locals: { user }, params: { id: String(trip.id) }, url: new URL(`https://roamarr.test/api/mobile/trips/${trip.id}/sharing`) } as any) as Response;
	const body = await response.json();
	expect(body.publicShareUrl).toMatch(/^https:\/\/roamarr\.test\/share\//);
	expect(body.feedUrl).toMatch(/^https:\/\/roamarr\.test\/trips\//);
	await call('revoke-public'); await call('revoke-calendar');
	const cleared = await GET({ locals: { user }, params: { id: String(trip.id) }, url: new URL('https://roamarr.test') } as any) as Response;
	expect(await cleared.json()).toMatchObject({ publicShareUrl: null, feedUrl: null });
});

test('mobile sharing cannot update a share from another trip', async () => {
	const row = makeKitUser({ email: 'owner@example.com', display_name: 'Owner' }), user = validateOAuthUser(Number(row.id))!;
	const viewer = makeKitUser({ email: 'viewer@example.com', display_name: 'Viewer' });
	const owned = createTrip(user.id, { name: 'Owned' });
	const other = createTrip(user.id, { name: 'Other' });
	const share = createShare({ tripId: other.id, sharedWithUserId: Number(viewer.id), permission: 'read' });
	await expect(POST({ locals: { user }, params: { id: String(owned.id) }, url: new URL('https://roamarr.test'), request: new Request('https://roamarr.test', { method: 'POST', body: JSON.stringify({ action: 'update-share', shareId: share.id, permission: 'edit', showDetails: true }) }) } as any)).rejects.toMatchObject({ status: 404 });
	expect(getShareById(share.id)).toMatchObject({ permission: 'read', showDetails: false });
});
