import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never, link: '' }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
vi.mock('$lib/server/notify', () => ({ sendMail: vi.fn(async (_to: string, message: { link: string }) => { ctx.link = message.link; return true; }) }));

import { actions, load } from './+page.server';
import { emailTripShare } from '$lib/server/tripSharing';
import { makeTrip, makeUser } from '../../../../tests/helpers';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { getUserByEmail } from '$lib/server/repositories/usersRepo';
import { getTripById } from '$lib/server/repositories/tripsRepo';
import { canEdit } from '$lib/server/sharing';

const kit = () => (ctx as { kit: KitDatabase }).kit;

test('invited outsider can register and claim trip while public registration is off', async () => {
	const owner = makeUser(kit(), { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const trip = makeTrip(kit(), owner.id, { name: 'T' });
	await emailTripShare(owner.id, trip.id, 'outsider@x.c', 'edit', 'https://roamarr.test');
	const token = ctx.link.split('/').pop()!;
	const data = load({ params: { token }, locals: { user: null } } as any) as { email: string; existingUser: boolean };
	expect(data).toMatchObject({ email: 'outsider@x.c', existingUser: false });
	const form = new FormData();
	form.set('displayName', 'Outsider');
	form.set('password', 'correcthorse');
	form.set('confirmPassword', 'correcthorse');
	await expect(actions.default({
		params: { token }, locals: { user: null }, request: new Request('https://roamarr.test', { method: 'POST', body: form }),
		cookies: { set: vi.fn() }, getClientAddress: () => '203.0.113.5'
	} as any)).rejects.toMatchObject({ status: 303, location: `/trips/${trip.id}` });
	const user = getUserByEmail('outsider@x.c')!;
	expect(canEdit(Number(user.id), getTripById(trip.id)!)).toBe(true);
});
