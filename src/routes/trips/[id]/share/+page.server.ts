import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import { logAudit } from '$lib/server/audit';
import { listGroupsForUser } from '$lib/server/sharing';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { parseTripId } from '$lib/server/params';
import { setFlash } from '$lib/server/flash';
import type { PageServerLoad } from './$types';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { regenerateCalendarToken, revokeCalendarToken } from '../../shared';
import {
	emailTripShare,
	parseSharePermission,
	shareWithUserEmail,
	listTripInvitations,
	revokeTripInvitation,
	validateShareEmail,
	type SharePermission
} from '$lib/server/tripSharing';

export function _shareWithUserEmail(
	ownerId: number,
	tripId: number,
	email: string,
	permission: SharePermission = 'read'
) {
	return shareWithUserEmail(ownerId, tripId, email, permission);
}

export function _shareWithGroup(
	ownerId: number,
	tripId: number,
	groupId: number,
	permission: SharePermission = 'read'
) {
	requireOwnedTrip(ownerId, tripId);
	// The group must be one the sharer owns or belongs to.
	const allowed = listGroupsForUser(ownerId).some((g) => g.id === groupId);
	if (!allowed) throw error(404, 'No such group');
	tripsRepo.createShare({
		tripId,
		sharedWithGroupId: groupId,
		permission
	});
	logAudit(ownerId, 'trip_share_group', 'trip', tripId, { sharedWithGroupId: groupId, permission });
}

export function _mintPublicToken(
	ownerId: number,
	tripId: number,
	publicShowDetails = false,
	expiresAt?: string | null
) {
	requireOwnedTrip(ownerId, tripId);
	const token = randomBytes(24).toString('base64url');
	tripsRepo.updateTrip(tripId, {
		publicToken: token,
		publicTokenExpiresAt: expiresAt ?? null,
		publicShowDetails
	});
	logAudit(ownerId, 'trip_public_token_mint', 'trip', tripId, {
		expiresAt: expiresAt ?? null,
		publicShowDetails
	});
	return token;
}

export function _setPublicShowDetails(ownerId: number, tripId: number, publicShowDetails: boolean) {
	requireOwnedTrip(ownerId, tripId);
	tripsRepo.updateTrip(tripId, { publicShowDetails });
	logAudit(ownerId, 'trip_public_set_show_details', 'trip', tripId, { publicShowDetails });
}

export function _unshareUser(ownerId: number, tripId: number, shareId: number) {
	requireOwnedTrip(ownerId, tripId);
	const share = tripsRepo.getShareById(shareId);
	tripsRepo.deleteShare(shareId);
	logAudit(ownerId, 'trip_unshare_user', 'trip', tripId, { shareId, sharedWithUserId: share?.sharedWithUserId });
}

export function _unshareGroup(ownerId: number, tripId: number, shareId: number) {
	requireOwnedTrip(ownerId, tripId);
	const share = tripsRepo.getShareById(shareId);
	tripsRepo.deleteShare(shareId);
	logAudit(ownerId, 'trip_unshare_group', 'trip', tripId, { shareId, sharedWithGroupId: share?.sharedWithGroupId });
}

export function _setShowDetails(
	ownerId: number,
	tripId: number,
	shareId: number,
	showDetails: boolean
) {
	requireOwnedTrip(ownerId, tripId);
	const share = tripsRepo.getShareById(shareId);
	if (!share || share.tripId !== tripId) throw error(404, 'Share not found');
	tripsRepo.updateShare(shareId, { showDetails });
	logAudit(ownerId, 'trip_share_set_show_details', 'trip', tripId, { shareId, showDetails });
}

export const load: PageServerLoad = ({ locals, params, url }) => {
	const u = requireUser(locals);
	const t = requireOwnedTrip(u.id, parseTripId(params));
	const rawShares = tripsRepo.listSharesForTrip(t.id);
	const shares = rawShares.map((s) => {
		const user = s.sharedWithUserId ? usersRepo.getUserById(s.sharedWithUserId) : null;
		return {
			...s,
			email: user?.email ?? null,
			displayName: user?.display_name ?? null,
			groupName: s.sharedWithGroupId
				? (tripsRepo.getGroupById(s.sharedWithGroupId)?.name ?? null)
				: null
		};
	});
	const myGroups = listGroupsForUser(u.id);
	const publicShareUrl = t.publicToken
		? `${url.origin}/share/${encodeURIComponent(t.publicToken)}`
		: null;
	const feedUrl = t.calendarToken
		? `${url.origin}/trips/${t.id}/calendar/feed?token=${encodeURIComponent(t.calendarToken)}`
		: null;
	return { trip: t, shares, invitations: listTripInvitations(u.id, t.id), groups: myGroups, publicShareUrl, feedUrl };
};

export const actions: Actions = {
	shareUser: async ({ request, locals, params, url, cookies }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const permission = parseSharePermission(f.get('permission'));
		if (!permission) return fail(400, { error: 'Invalid permission' });
		const email = validateShareEmail(String(f.get('email')));
		if (!email) return fail(400, { error: 'Enter a valid email address' });
		const result = await emailTripShare(
			u.id,
			parseTripId(params),
			email,
			permission,
			url.origin
		);
		setFlash(cookies, result.sent ? (result.pending ? 'Invitation sent.' : 'Trip shared and email sent.') : { message: result.pending ? 'Invitation created, but SMTP is not configured or delivery failed.' : 'Trip shared, but SMTP is not configured or delivery failed.', variant: 'warning' });
		throw redirect(303, `/trips/${params.id}/share`);
	},
	revokeInvitation: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const invitationId = Number((await request.formData()).get('invitationId'));
		if (!Number.isInteger(invitationId) || invitationId <= 0) return fail(400, { error: 'Invalid invitation' });
		revokeTripInvitation(user.id, parseTripId(params), invitationId);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	shareGroup: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const permission = parseSharePermission(f.get('permission'));
		if (!permission) return fail(400, { error: 'Invalid permission' });
		_shareWithGroup(u.id, parseTripId(params), Number(f.get('groupId')), permission);
		throw redirect(303, `/trips/${params.id}`);
	},
	makePublic: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const expiresAt = String(f.get('publicExpiresAt') || '');
		const publicShowDetails = String(f.get('publicShowDetails')) === '1';
		_mintPublicToken(u.id, parseTripId(params), publicShowDetails, expiresAt || null);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	setPublicShowDetails: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const publicShowDetails = String(f.get('publicShowDetails')) === '1';
		_setPublicShowDetails(u.id, parseTripId(params), publicShowDetails);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	revokePublic: async ({ locals, params }) => {
		const u = requireUser(locals);
		const tripId = parseTripId(params);
		requireOwnedTrip(u.id, tripId);
		tripsRepo.updateTrip(tripId, {
			publicToken: null,
			publicTokenExpiresAt: null,
			publicShowDetails: false
		});
		logAudit(u.id, 'trip_public_token_revoke', 'trip', tripId);
		throw redirect(303, `/trips/${params.id}`);
	},
	unshareUser: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const shareId = Number((await request.formData()).get('shareId'));
		_unshareUser(u.id, parseTripId(params), shareId);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	unshareGroup: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const shareId = Number((await request.formData()).get('shareId'));
		_unshareGroup(u.id, parseTripId(params), shareId);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	setShowDetails: async ({ request, locals, params }) => {
		const u = requireUser(locals);
		const f = await request.formData();
		const shareId = Number(f.get('shareId'));
		const showDetails = String(f.get('showDetails')) === '1';
		if (!Number.isFinite(shareId)) return fail(400, { error: 'Invalid share' });
		_setShowDetails(u.id, parseTripId(params), shareId, showDetails);
		throw redirect(303, `/trips/${params.id}/share`);
	},
	regenerateCalendarFeed: async ({ request, locals, params, cookies }) => {
		const u = requireUser(locals);
		const tripId = parseTripId(params);
		const expiresAt = String((await request.formData()).get('calendarExpiresAt') || '');
		regenerateCalendarToken(u.id, tripId, expiresAt || null);
		setFlash(cookies, 'Calendar feed URL generated.');
		throw redirect(303, `/trips/${tripId}/share`);
	},
	revokeCalendarFeed: async ({ locals, params, cookies }) => {
		const u = requireUser(locals);
		const tripId = parseTripId(params);
		revokeCalendarToken(u.id, tripId);
		setFlash(cookies, 'Calendar feed URL revoked.');
		throw redirect(303, `/trips/${tripId}/share`);
	}
};
