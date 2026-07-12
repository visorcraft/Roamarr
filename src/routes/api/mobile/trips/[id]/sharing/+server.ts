import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/auth';
import { requireOwnedTrip } from '$lib/server/ownership';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import * as usersRepo from '$lib/server/repositories/usersRepo';
import { listGroupsForUser } from '$lib/server/sharing';
import { emailTripShare, listTripInvitations, revokeTripInvitation } from '$lib/server/tripSharing';
import { _mintPublicToken, _setPublicShowDetails, _setShowDetails, _shareWithGroup, _unshareGroup, _unshareUser } from '../../../../../trips/[id]/share/+page.server';
import { regenerateCalendarToken, revokeCalendarToken } from '../../../../../trips/shared';
import { logAudit } from '$lib/server/audit';

const id = (raw: string | undefined) => { const value = Number(raw); if (!Number.isSafeInteger(value) || value < 1) throw error(400, 'Invalid id'); return value; };
const permission = (value: unknown) => value === 'edit' ? 'edit' as const : value === 'read' ? 'read' as const : null;

export const GET: RequestHandler = ({ locals, params, url }) => {
	const user = requireUser(locals), trip = requireOwnedTrip(user.id, id(params.id));
	const shares = tripsRepo.listSharesForTrip(trip.id).map((share) => ({ ...share,
		email: share.sharedWithUserId ? usersRepo.getUserById(share.sharedWithUserId)?.email ?? null : null,
		groupName: share.sharedWithGroupId ? tripsRepo.getGroupById(share.sharedWithGroupId)?.name ?? null : null
	}));
	return json({ trip, shares, invitations: listTripInvitations(user.id, trip.id), groups: listGroupsForUser(user.id),
		publicShareUrl: trip.publicToken ? `${url.origin}/share/${encodeURIComponent(trip.publicToken)}` : null,
		feedUrl: trip.calendarToken ? `${url.origin}/trips/${trip.id}/calendar/feed?token=${encodeURIComponent(trip.calendarToken)}` : null });
};

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	const user = requireUser(locals), tripId = id(params.id), body = await request.json() as Record<string, unknown>, action = String(body.action ?? '');
	requireOwnedTrip(user.id, tripId);
	if (action === 'share-user') { const access = permission(body.permission); if (!access || typeof body.email !== 'string') throw error(400, 'Email and permission required'); return json(await emailTripShare(user.id, tripId, body.email, access, url.origin)); }
	if (action === 'share-group') { const access = permission(body.permission); if (!access) throw error(400, 'Invalid permission'); _shareWithGroup(user.id, tripId, id(String(body.groupId)), access); }
	else if (action === 'update-share') { const shareId = id(String(body.shareId)), share = tripsRepo.getShareById(shareId), access = permission(body.permission); if (!share || share.tripId !== tripId) throw error(404, 'Share not found'); if (access) tripsRepo.updateShare(shareId, { permission: access }); _setShowDetails(user.id, tripId, shareId, body.showDetails === true); }
	else if (action === 'revoke-share') { const shareId = id(String(body.shareId)), share = tripsRepo.getShareById(shareId); if (!share || share.tripId !== tripId) throw error(404, 'Share not found'); if (share.sharedWithGroupId) _unshareGroup(user.id, tripId, shareId); else _unshareUser(user.id, tripId, shareId); }
	else if (action === 'revoke-invitation') revokeTripInvitation(user.id, tripId, id(String(body.invitationId)));
	else if (action === 'make-public') _mintPublicToken(user.id, tripId, body.showDetails === true, typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null);
	else if (action === 'update-public') _setPublicShowDetails(user.id, tripId, body.showDetails === true);
	else if (action === 'revoke-public') { tripsRepo.updateTrip(tripId, { publicToken: null, publicTokenExpiresAt: null, publicShowDetails: false }); logAudit(user.id, 'trip_public_token_revoke', 'trip', tripId); }
	else if (action === 'regenerate-calendar') regenerateCalendarToken(user.id, tripId, typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null);
	else if (action === 'revoke-calendar') revokeCalendarToken(user.id, tripId);
	else throw error(400, 'Unknown action');
	return json({ ok: true });
};
