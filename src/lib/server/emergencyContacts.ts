import { and, desc, eq, ne } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db';
import { emergencyContacts } from './db/schema';
import { logAudit } from './audit';

export interface EmergencyContactInput {
	name: string;
	relationship?: string;
	phone?: string;
	email?: string;
	isPrimary?: boolean;
}

export interface EmergencyContactRow {
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
	if (!name) throw new Error('Name is required');

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
	if (!name) throw new Error('Name is required');

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
