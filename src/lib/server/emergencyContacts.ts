import { error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import * as tripsRepo from './repositories/tripsRepo';
import { logAudit } from './audit';
import { requireOwnedTrip } from './ownership';
import { sendMail } from './notify';
import {
	createEmergencyContact as createRepo,
	updateEmergencyContact as updateRepo,
	deleteEmergencyContact as deleteRepo,
	getEmergencyContactById
} from './repositories/profileRepo';

export { listEmergencyContacts } from './repositories/profileRepo';

interface EmergencyContactInput {
	name: string;
	relationship?: string;
	phone?: string;
	email?: string;
	isPrimary?: boolean;
}

export function addEmergencyContact(userId: number, input: EmergencyContactInput) {
	return createRepo(userId, {
		name: input.name,
		relationship: input.relationship,
		phone: input.phone,
		email: input.email,
		isPrimary: input.isPrimary
	});
}

export function updateEmergencyContact(
	userId: number,
	contactId: number,
	input: EmergencyContactInput
) {
	return updateRepo(contactId, userId, {
		name: input.name,
		relationship: input.relationship,
		phone: input.phone,
		email: input.email,
		isPrimary: input.isPrimary
	});
}

export function deleteEmergencyContact(userId: number, contactId: number) {
	return deleteRepo(contactId, userId);
}

const SHARE_WINDOW_MS = 60_000;
const SHARE_MAX_ATTEMPTS = 3;
/**
 * Hard cap on tracked share-rate-limit buckets. Same rationale as the HTTP
 * rate limiter: without a cap, distinct user/trip/contact keys accumulate for
 * the process lifetime (a restart-cured leak). On overflow we drop expired
 * buckets, then evict the bucket closest to expiring.
 */
export const MAX_SHARE_WINDOW_ENTRIES = 50_000;
const shareWindow = new Map<string, { count: number; resetAt: number }>();

/** Delete every expired bucket. Returns the number removed (scheduler + tests). */
export function pruneExpiredShareWindow(now: number = Date.now()): number {
	let removed = 0;
	for (const [key, entry] of shareWindow) {
		if (now >= entry.resetAt) {
			shareWindow.delete(key);
			removed += 1;
		}
	}
	return removed;
}

/** Current number of tracked buckets. Exported for tests/diagnostics. */
export function shareRateLimitSize(): number {
	return shareWindow.size;
}

function evictNearestExpiry(): void {
	let oldestKey: string | null = null;
	let oldestReset = Infinity;
	for (const [key, entry] of shareWindow) {
		if (entry.resetAt < oldestReset) {
			oldestReset = entry.resetAt;
			oldestKey = key;
		}
	}
	if (oldestKey !== null) shareWindow.delete(oldestKey);
}

export function checkShareRateLimit(userId: number, tripId: number, contactId: number): boolean {
	const key = `${userId}:${tripId}:${contactId}`;
	const now = Date.now();
	const entry = shareWindow.get(key);
	if (!entry) {
		if (shareWindow.size >= MAX_SHARE_WINDOW_ENTRIES) {
			pruneExpiredShareWindow(now);
			if (shareWindow.size >= MAX_SHARE_WINDOW_ENTRIES) evictNearestExpiry();
		}
		shareWindow.set(key, { count: 1, resetAt: now + SHARE_WINDOW_MS });
		return true;
	}
	if (now >= entry.resetAt) {
		shareWindow.set(key, { count: 1, resetAt: now + SHARE_WINDOW_MS });
		return true;
	}
	entry.count += 1;
	return entry.count <= SHARE_MAX_ATTEMPTS;
}

export function resetEmergencyShareRateLimit(userId?: number, tripId?: number, contactId?: number) {
	if (userId == null && tripId == null && contactId == null) {
		shareWindow.clear();
		return;
	}
	for (const key of shareWindow.keys()) {
		const [kUser, kTrip, kContact] = key.split(':').map(Number);
		if (
			(userId == null || kUser === userId) &&
			(tripId == null || kTrip === tripId) &&
			(contactId == null || kContact === contactId)
		) {
			shareWindow.delete(key);
		}
	}
}

export async function shareItineraryWithContact(
	userId: number,
	tripId: number,
	contactId: number,
	origin: string
) {
	const contact = getEmergencyContactById(contactId, userId);
	if (!contact) throw error(404, 'Not found');
	if (!contact.email?.trim()) throw error(400, 'Contact has no email address');

	const trip = requireOwnedTrip(userId, tripId);

	if (!checkShareRateLimit(userId, tripId, contactId)) {
		throw error(429, 'Please wait before sharing this itinerary again');
	}

	let token = trip.publicToken;
	if (!token) {
		token = randomBytes(24).toString('base64url');
		tripsRepo.updateTrip(tripId, { publicToken: token });
	}

	const link = `${origin}/share/${encodeURIComponent(token)}`;
	const sent = await sendMail(
		contact.email.trim(),
		{
			title: `Itinerary shared: ${trip.name}`,
			body: `You have been sent an itinerary for "${trip.name}". Open the link below to view the trip details.`,
			link
		},
		userId
	);

	logAudit(userId, 'emergency_share', 'trip', tripId, {
		contactId,
		email: contact.email.trim(),
		sent
	});

	return { contact, trip, link, sent };
}
