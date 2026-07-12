import { expect, test, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET } from './+server';
import { makeTrip, makeUser } from '../../../../../../tests/helpers';
import type { KitDatabase } from '@visorcraft/mongreldb-kit';
import { createShare } from '$lib/server/repositories/tripsRepo';

const kit = () => (ctx as { kit: KitDatabase }).kit;

test('owner can search active users but editor cannot enumerate directory', async () => {
	const owner = makeUser(kit(), { email: 'owner@x.c', passwordHash: 'x', displayName: 'Owner' });
	const target = makeUser(kit(), { email: 'target@x.c', passwordHash: 'x', displayName: 'Target Person' });
	const editor = makeUser(kit(), { email: 'editor@x.c', passwordHash: 'x', displayName: 'Editor' });
	const trip = makeTrip(kit(), owner.id, { name: 'T' });
	createShare({ tripId: trip.id, sharedWithUserId: editor.id, permission: 'edit' });
	const response = await GET({ locals: { user: owner }, params: { id: String(trip.id) }, url: new URL(`https://x.test/trips/${trip.id}/people/users?q=Target`), getClientAddress: () => '198.51.100.2' } as any);
	expect(await response.json()).toEqual({ users: [{ id: target.id, label: 'Target Person', secondary: 'target@x.c' }] });
	await expect(async () => GET({ locals: { user: editor }, params: { id: String(trip.id) }, url: new URL(`https://x.test/trips/${trip.id}/people/users?q=Target`), getClientAddress: () => '198.51.100.3' } as any)).rejects.toMatchObject({ status: 404 });
});
