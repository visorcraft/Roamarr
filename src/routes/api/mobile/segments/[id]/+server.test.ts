import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { GET, PATCH } from './+server';
import { kit } from '$lib/server/db';
import { makeUser, makeTrip, makeSegment, makeCompanion } from '../../../../../../tests/helpers';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { addAttendee } from '$lib/server/repositories/segmentsRepo';
import type { AppUser } from '$lib/server/auth';

const EXPECTED_KEYS = [
	'id', 'tripId', 'type', 'title', 'localStart', 'startTz', 'endAt', 'endTz', 'location',
	'cityName', 'countryCode', 'venue', 'meetingPoint', 'meetingAt', 'status'
].sort();

function event(user: unknown, id: string | undefined) {
	return { locals: { user }, params: { id } } as never;
}

function makeFixture() {
	const owner = makeUser(kit, { email: 'owner@x.c' });
	const editorNoDetails = makeUser(kit, { email: 'editor-no-details@x.c' });
	const viewerNoDetails = makeUser(kit, { email: 'viewer-no-details@x.c' });
	const viewerDetails = makeUser(kit, { email: 'viewer-details@x.c' });
	const outsider = makeUser(kit, { email: 'outsider@x.c' });
	const trip = makeTrip(kit, owner.id, { name: 'T' });
	const segment = makeSegment(kit, trip.id, {
		type: 'flight',
		title: 'UA1',
		startAt: '2026-07-01T15:00:00Z',
		startTz: 'UTC',
		confirmationNumber: 'CONF-SECRET-4242',
		detailsJson: 'SEAT-SECRET'
	});
	const companion = makeCompanion(kit, trip.id, { name: 'Comp' });
	addAttendee({ segment_id: BigInt(segment.id), companion_id: BigInt(companion.id), status: 'going' });
	tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: editorNoDetails.id, permission: 'edit', showDetails: false });
	tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerNoDetails.id, permission: 'read', showDetails: false });
	tripsRepo.createShare({ tripId: trip.id, sharedWithUserId: viewerDetails.id, permission: 'read', showDetails: true });
	return { owner, editorNoDetails, viewerNoDetails, viewerDetails, outsider, trip, segment };
}

const fx = makeFixture();

test('owner receives the full row', async () => {
	const res = await GET(event(fx.owner as AppUser, String(fx.segment.id)));
	const body = await res.json();
	expect(body.segment.confirmationNumber).toBe('CONF-SECRET-4242');
	expect(String(body.segment.detailsJson)).toContain('SEAT-SECRET');
	expect(body.attendees).toHaveLength(1);
});

test('edit share without details gets the reduced projection and attendees', async () => {
	const res = await GET(event(fx.editorNoDetails as AppUser, String(fx.segment.id)));
	const body = await res.json();
	expect('confirmationNumber' in body.segment).toBe(false);
	expect('detailsJson' in body.segment).toBe(false);
	expect(JSON.stringify(body)).not.toContain('CONF-SECRET-4242');
	expect(JSON.stringify(body)).not.toContain('SEAT-SECRET');
	expect(Object.keys(body.segment).sort()).toEqual(EXPECTED_KEYS);
	expect(body.attendees).toHaveLength(1);
});

test('view share without details gets the reduced projection and no attendees', async () => {
	const res = await GET(event(fx.viewerNoDetails as AppUser, String(fx.segment.id)));
	const body = await res.json();
	expect('confirmationNumber' in body.segment).toBe(false);
	expect('detailsJson' in body.segment).toBe(false);
	expect(JSON.stringify(body)).not.toContain('CONF-SECRET-4242');
	expect(JSON.stringify(body)).not.toContain('SEAT-SECRET');
	expect(Object.keys(body.segment).sort()).toEqual(EXPECTED_KEYS);
	expect(body.attendees).toEqual([]);
});

test('view share with details gets the full row and attendees', async () => {
	const res = await GET(event(fx.viewerDetails as AppUser, String(fx.segment.id)));
	const body = await res.json();
	expect(body.segment.confirmationNumber).toBe('CONF-SECRET-4242');
	expect(String(body.segment.detailsJson)).toContain('SEAT-SECRET');
	expect(body.attendees).toHaveLength(1);
});

test('outsider gets 404 with no body', async () => {
	try {
		await GET(event(fx.outsider as AppUser, String(fx.segment.id)));
		expect.fail('expected error');
	} catch (e: any) {
		expect(e.status).toBe(404);
	}
});

test('group shares gate private details on showDetails', async () => {
	const detailsMember = makeUser(kit, { email: 'group-details@x.c' });
	const noDetailsMember = makeUser(kit, { email: 'group-no-details@x.c' });
	const detailsGroup = tripsRepo.createGroup({ ownerId: fx.owner.id, name: 'details-group' });
	tripsRepo.addGroupMember(detailsGroup.id, detailsMember.id);
	tripsRepo.createShare({ tripId: fx.trip.id, sharedWithGroupId: detailsGroup.id, showDetails: true });
	const noDetailsGroup = tripsRepo.createGroup({ ownerId: fx.owner.id, name: 'no-details-group' });
	tripsRepo.addGroupMember(noDetailsGroup.id, noDetailsMember.id);
	tripsRepo.createShare({ tripId: fx.trip.id, sharedWithGroupId: noDetailsGroup.id, showDetails: false });

	const fullRes = await GET(event(detailsMember as AppUser, String(fx.segment.id)));
	const fullBody = await fullRes.json();
	expect(fullBody.segment.confirmationNumber).toBe('CONF-SECRET-4242');
	expect(String(fullBody.segment.detailsJson)).toContain('SEAT-SECRET');
	expect(fullBody.attendees).toHaveLength(1);

	const reducedRes = await GET(event(noDetailsMember as AppUser, String(fx.segment.id)));
	const reducedBody = await reducedRes.json();
	expect('confirmationNumber' in reducedBody.segment).toBe(false);
	expect('detailsJson' in reducedBody.segment).toBe(false);
	expect(JSON.stringify(reducedBody)).not.toContain('CONF-SECRET-4242');
	expect(JSON.stringify(reducedBody)).not.toContain('SEAT-SECRET');
	expect(Object.keys(reducedBody.segment).sort()).toEqual(EXPECTED_KEYS);
});

test('PATCH from an edit share without details returns the reduced projection without leaking secrets', async () => {
	const patchSeg = makeSegment(kit, fx.trip.id, {
		type: 'flight',
		title: 'UA2',
		startAt: '2026-07-02T15:00:00Z',
		startTz: 'UTC',
		confirmationNumber: 'CONF-PATCH-9999',
		detailsJson: JSON.stringify({ seat: 'SEAT-PATCH-SECRET' })
	});
	const req = new Request(`http://localhost/api/mobile/segments/${patchSeg.id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ title: 'UA2 Updated' })
	});
	const res = await PATCH({ locals: { user: fx.editorNoDetails as AppUser }, params: { id: String(patchSeg.id) }, request: req } as never);
	const body = await res.json();
	expect(body.segment.title).toBe('UA2 Updated');
	expect('confirmationNumber' in body.segment).toBe(false);
	expect('detailsJson' in body.segment).toBe(false);
	expect(JSON.stringify(body)).not.toContain('CONF-PATCH-9999');
	expect(JSON.stringify(body)).not.toContain('SEAT-PATCH-SECRET');
	expect(Object.keys(body.segment).sort()).toEqual(EXPECTED_KEYS);

	// Stored private fields stay intact for the owner.
	const ownerRes = await GET(event(fx.owner as AppUser, String(patchSeg.id)));
	const ownerBody = await ownerRes.json();
	expect(ownerBody.segment.confirmationNumber).toBe('CONF-PATCH-9999');
	expect(String(ownerBody.segment.detailsJson)).toContain('SEAT-PATCH-SECRET');
});

test('load rejects malformed and unknown ids with 404', async () => {
	for (const id of ['0', '-1', '1.5', 'abc', undefined, '999999']) {
		try {
			await GET(event(fx.owner as AppUser, id));
			expect.fail(`expected 404 for id ${id}`);
		} catch (e: any) {
			expect(e.status).toBe(404);
		}
	}
});
