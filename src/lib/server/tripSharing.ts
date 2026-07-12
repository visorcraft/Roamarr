import { error } from '@sveltejs/kit';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt } from '@visorcraft/mongreldb-kit';
import { logAudit } from './audit';
import { kit } from './db';
import { tripInvitations } from './db/mongrelSchema';
import { sendMail } from './notify';
import { requireOwnedTrip } from './ownership';
import * as tripsRepo from './repositories/tripsRepo';
import * as usersRepo from './repositories/usersRepo';
import { nowIso, utcIsoAfter } from './tz';
import { normalizeEmail } from './users';

export type SharePermission = import('./repositories/tripsRepo').SharePermission;

const SHARE_PERMISSIONS: SharePermission[] = ['read', 'edit'];
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function validateShareEmail(raw: string) {
	const email = normalizeEmail(raw);
	return email && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

export function parseSharePermission(raw: unknown): SharePermission | undefined {
	const value = typeof raw === 'string' ? raw : 'read';
	return SHARE_PERMISSIONS.includes(value as SharePermission)
		? (value as SharePermission)
		: undefined;
}

export function shareWithUserEmail(
	ownerId: number,
	tripId: number,
	email: string,
	permission: SharePermission = 'read'
) {
	const trip = requireOwnedTrip(ownerId, tripId);
	const normalized = normalizeEmail(email);
	const target = usersRepo.getUserByEmail(normalized);
	if (!target || target.disabled) throw error(404, 'No active Roamarr user has that email address');
	const existing = tripsRepo.getDirectShareForTrip(tripId, Number(target.id));
	if (existing) tripsRepo.updateShare(existing.id, { permission });
	else tripsRepo.createShare({ tripId, sharedWithUserId: Number(target.id), permission });
	kit.deleteFrom(tripInvitations).where(and(eq(tripInvitations.trip_id, BigInt(tripId)), eq(tripInvitations.email, normalized))).executeSync();
	logAudit(ownerId, 'trip_share_user', 'trip', tripId, {
		sharedWithUserId: Number(target.id),
		permission
	});
	return { trip, target };
}

function createInvitation(ownerId: number, tripId: number, email: string, permission: SharePermission) {
	const trip = requireOwnedTrip(ownerId, tripId);
	const normalized = validateShareEmail(email);
	if (!normalized) throw error(400, 'Enter a valid email address');
	const token = randomBytes(32).toString('base64url');
	const values = {
		trip_id: BigInt(tripId),
		invited_by_user_id: BigInt(ownerId),
		email: normalized,
		permission,
		token_hash: tokenHash(token),
		expires_at: utcIsoAfter({ days: 7 })
	};
	const existing = kit.selectFrom(tripInvitations).where(and(eq(tripInvitations.trip_id, BigInt(tripId)), eq(tripInvitations.email, normalized))).executeSync()[0];
	if (existing) kit.updateTable(tripInvitations).set(values).where(eq(tripInvitations.id, existing.id)).executeSync();
	else kit.insertInto(tripInvitations).values(values).executeSync();
	logAudit(ownerId, 'trip_invitation_create', 'trip', tripId, { email: normalized, permission });
	return { trip, email: normalized, token };
}

export async function emailTripShare(
	ownerId: number,
	tripId: number,
	email: string,
	permission: SharePermission,
	origin: string
) {
	const normalized = normalizeEmail(email);
	const target = usersRepo.getUserByEmail(normalized);
	if (target?.disabled) throw error(400, 'That Roamarr user is disabled');
	const prepared = target && !target.disabled
		? { ...shareWithUserEmail(ownerId, tripId, normalized, permission), email: target.email, token: null }
		: { ...createInvitation(ownerId, tripId, normalized, permission), target: null };
	const owner = usersRepo.getUserById(ownerId);
	const link = prepared.token
		? `${origin}/invite/${prepared.token}`
		: `${origin}/trips/${tripId}`;
	try {
		const sent = await sendMail(
			prepared.email,
			{
				title: `${owner?.display_name || 'Someone'} invited you to ${prepared.trip.name}`,
				body: prepared.token
					? `Create an account or sign in to get ${permission === 'edit' ? 'edit' : 'read-only'} access in Roamarr. This invitation expires in 7 days.`
					: `You now have ${permission === 'edit' ? 'edit' : 'read-only'} access to this trip in Roamarr.`,
				link
			},
			ownerId
		);
		return { sent, pending: Boolean(prepared.token), targetUserId: prepared.target ? Number(prepared.target.id) : null };
	} catch (cause) {
		console.error('[trip share] email delivery failed:', cause);
		return { sent: false, pending: Boolean(prepared.token), targetUserId: prepared.target ? Number(prepared.target.id) : null };
	}
}

export function getInvitationByToken(token: string) {
	const row = kit.selectFrom(tripInvitations).where(eq(tripInvitations.token_hash, tokenHash(token))).executeSync()[0];
	return row && row.expires_at >= nowIso() ? row : null;
}

export function claimInvitation(token: string, userId: number) {
	const invitation = getInvitationByToken(token);
	if (!invitation) throw error(404, 'Invitation not found or expired');
	const user = usersRepo.getUserById(userId);
	if (!user || user.disabled || normalizeEmail(user.email) !== invitation.email) throw error(403, 'This invitation belongs to another email address');
	const tripId = Number(invitation.trip_id);
	const permission = invitation.permission as SharePermission;
	const existing = tripsRepo.getDirectShareForTrip(tripId, userId);
	if (existing) tripsRepo.updateShare(existing.id, { permission });
	else tripsRepo.createShare({ tripId, sharedWithUserId: userId, permission });
	kit.deleteFrom(tripInvitations).where(eq(tripInvitations.id, invitation.id)).executeSync();
	logAudit(userId, 'trip_invitation_accept', 'trip', tripId, { permission });
	return tripId;
}

export function listTripInvitations(ownerId: number, tripId: number) {
	requireOwnedTrip(ownerId, tripId);
	return kit.selectFrom(tripInvitations).where(eq(tripInvitations.trip_id, BigInt(tripId))).executeSync().filter((row) => row.expires_at >= nowIso()).map((row) => ({
		id: Number(row.id), email: row.email, permission: row.permission, expiresAt: row.expires_at
	}));
}

export function revokeTripInvitation(ownerId: number, tripId: number, invitationId: number) {
	requireOwnedTrip(ownerId, tripId);
	const deleted = kit.deleteFrom(tripInvitations).where(and(eq(tripInvitations.id, BigInt(invitationId)), eq(tripInvitations.trip_id, BigInt(tripId)))).executeSync();
	if (!deleted) throw error(404, 'Invitation not found');
	logAudit(ownerId, 'trip_invitation_revoke', 'trip', tripId, { invitationId });
}

export function purgeExpiredTripInvitations() {
	return Number(kit.deleteFrom(tripInvitations).where(lt(tripInvitations.expires_at, nowIso())).executeSync());
}
