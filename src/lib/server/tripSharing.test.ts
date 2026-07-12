import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never, sent: [] as Array<Record<string, unknown>> }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('./notify', () => ({ sendMail: vi.fn(async (_to: string, message: Record<string, unknown>) => { ctx.sent.push(message); return true; }) }));

import { claimInvitation, emailTripShare, listTripInvitations, revokeTripInvitation } from './tripSharing';
import { makeTrip, makeUser } from '../../../tests/helpers';
import { canView } from './sharing';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { getTripById } from './repositories/tripsRepo';

const kit = () => (ctx as { kit: KitDatabase }).kit;

test('unknown email receives claimable invitation and wrong user cannot claim it', async () => {
	ctx.sent.length = 0;
	const owner = makeUser(kit(), { email: 'invite-owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const wrong = makeUser(kit(), { email: 'wrong@x.c', passwordHash: 'x', displayName: 'Wrong' });
	const trip = makeTrip(kit(), owner.id, { name: 'T' });
	const result = await emailTripShare(owner.id, trip.id, 'new@x.c', 'edit', 'https://roamarr.test');
	expect(result).toMatchObject({ sent: true, pending: true, targetUserId: null });
	const token = String(ctx.sent[0].link).split('/').pop()!;
	expect(() => claimInvitation(token, wrong.id)).toThrow();
	const invited = makeUser(kit(), { email: 'new@x.c', passwordHash: 'x', displayName: 'New' });
	expect(claimInvitation(token, invited.id)).toBe(trip.id);
	expect(canView(invited.id, getTripById(trip.id)!)).toBe(true);
	expect(listTripInvitations(owner.id, trip.id)).toHaveLength(0);
});

test('pending invitations can be revoked', async () => {
	const owner = makeUser(kit(), { email: 'revoke-owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const trip = makeTrip(kit(), owner.id, { name: 'T' });
	await emailTripShare(owner.id, trip.id, 'pending@x.c', 'read', 'https://roamarr.test');
	const invitation = listTripInvitations(owner.id, trip.id)[0];
	revokeTripInvitation(owner.id, trip.id, invitation.id);
	expect(listTripInvitations(owner.id, trip.id)).toHaveLength(0);
});
