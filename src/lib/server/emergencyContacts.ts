import { and, desc, eq, ne } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { emergencyContacts, trips } from './db/schema';
import { logAudit } from './audit';
import { requireOwnedTrip } from './ownership';
import { sendMail } from './notify';

interface EmergencyContactInput {
	name: string;
	relationship?: string;
	phone?: string;
	email?: string;
	isPrimary?: boolean;
}

interface EmergencyContactRow {
	id: number;
	userId: number;
	name: string;
	relationship: string | null;
	phone: string | null;
	email: string | null;
	isPrimary: boolean;
	createdAt: string;
}

function requireOwnedContact(userId: number, contactId: number): EmergencyContactRow {
	const row = db
		.select()
		.from(emergencyContacts)
		.where(and(eq(emergencyContacts.id, contactId), eq(emergencyContacts.userId, userId)))
		.get();
	if (!row) throw error(404, 'Not found');
	return row as EmergencyContactRow;
}

function clearOtherPrimary(userId: number, exceptId?: number) {
	const conditions = [eq(emergencyContacts.userId, userId), eq(emergencyContacts.isPrimary, true)];
	if (exceptId != null) conditions.push(ne(emergencyContacts.id, exceptId));
	db.update(emergencyContacts).set({ isPrimary: false }).where(and(...conditions)).run();
}

export function listEmergencyContacts(userId: number): EmergencyContactRow[] {
	return db
		.select()
		.from(emergencyContacts)
		.where(eq(emergencyContacts.userId, userId))
		.orderBy(desc(emergencyContacts.isPrimary), emergencyContacts.name)
		.all() as EmergencyContactRow[];
}

export function addEmergencyContact(userId: number, input: EmergencyContactInput): EmergencyContactRow {
	const name = input.name.trim();
	if (!name) throw error(400, 'Name is required');

	const isPrimary = input.isPrimary ?? false;
	if (isPrimary) clearOtherPrimary(userId);

	const row = db
		.insert(emergencyContacts)
		.values({
			userId,
			name,
			relationship: input.relationship?.trim() || null,
			phone: input.phone?.trim() || null,
			email: input.email?.trim() || null,
			isPrimary
		})
		.returning()
		.get();

	logAudit(userId, 'emergency_contact_create', 'emergency_contact', row.id, {
		name,
		isPrimary
	});
	return row as EmergencyContactRow;
}

export function updateEmergencyContact(
	userId: number,
	contactId: number,
	input: EmergencyContactInput
): EmergencyContactRow {
	requireOwnedContact(userId, contactId);
	const name = input.name.trim();
	if (!name) throw error(400, 'Name is required');

	const isPrimary = input.isPrimary ?? false;
	if (isPrimary) clearOtherPrimary(userId, contactId);

	const row = db
		.update(emergencyContacts)
		.set({
			name,
			relationship: input.relationship?.trim() || null,
			phone: input.phone?.trim() || null,
			email: input.email?.trim() || null,
			isPrimary
		})
		.where(eq(emergencyContacts.id, contactId))
		.returning()
		.get();

	logAudit(userId, 'emergency_contact_update', 'emergency_contact', contactId, {
		name,
		isPrimary
	});
	return row as EmergencyContactRow;
}

export function deleteEmergencyContact(userId: number, contactId: number) {
	requireOwnedContact(userId, contactId);
	db.delete(emergencyContacts).where(eq(emergencyContacts.id, contactId)).run();
	logAudit(userId, 'emergency_contact_delete', 'emergency_contact', contactId);
}

const SHARE_WINDOW_MS = 60_000;
const SHARE_MAX_ATTEMPTS = 3;
const shareWindow = new Map<string, { count: number; resetAt: number }>();

function checkShareRateLimit(userId: number, tripId: number, contactId: number): boolean {
	const key = `${userId}:${tripId}:${contactId}`;
	const now = Date.now();
	const entry = shareWindow.get(key);
	if (!entry || now >= entry.resetAt) {
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
	const contact = db
		.select()
		.from(emergencyContacts)
		.where(and(eq(emergencyContacts.id, contactId), eq(emergencyContacts.userId, userId)))
		.get();
	if (!contact) throw error(404, 'Not found');
	if (!contact.email?.trim()) throw error(400, 'Contact has no email address');

	const trip = requireOwnedTrip(userId, tripId);

	if (!checkShareRateLimit(userId, tripId, contactId)) {
		throw error(429, 'Please wait before sharing this itinerary again');
	}

	let token = trip.publicToken;
	if (!token) {
		token = randomBytes(24).toString('base64url');
		db.update(trips).set({ publicToken: token }).where(eq(trips.id, tripId)).run();
	}

	const link = `${origin}/share/${encodeURIComponent(token)}`;
	const sent = await sendMail(contact.email.trim(), {
		title: `Itinerary shared: ${trip.name}`,
		body: `You have been sent an itinerary for "${trip.name}". Open the link below to view the trip details.`,
		link
	});

	logAudit(userId, 'emergency_share', 'trip', tripId, {
		contactId,
		email: contact.email.trim(),
		sent
	});

	return { contact, trip, link, sent };
}
