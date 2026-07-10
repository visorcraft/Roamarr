import { DateTime } from 'luxon';
import * as tripsRepo from './repositories/tripsRepo';
import * as usersRepo from './repositories/usersRepo';
import * as segmentsRepo from './repositories/segmentsRepo';
import * as profileRepo from './repositories/profileRepo';
import {
	upsertReminderBySource,
	deleteReminder,
	deleteRemindersForRef,
	listPendingRemindersBefore,
	markReminderSent,
	updateReminder,
	getReminderById,
	listRemindersForUser as listRemindersForUserFromRepo,
	type ReminderRow
} from './repositories/remindersRepo';
import { deliver } from './notify';
import { error } from '@sveltejs/kit';
import { nowIso } from './tz';

type Segment = ReturnType<typeof segmentsRepo.toSegmentRow>;
type Doc = profileRepo.TravelDocument;
type Reminder = ReminderRow;

export function computeFireAt(
	kind: 'flight_checkin' | 'document_expiry' | 'custom',
	ref: string,
	opts: {
		tz?: string;
		flightCheckinLeadHours?: number;
		documentExpiryLeadDays?: number;
		customOffsetMinutes?: number;
	} = {}
): string {
	if (kind === 'custom') {
		const offset = opts.customOffsetMinutes ?? 0;
		return DateTime.fromISO(ref, { zone: 'utc' }).minus({ minutes: offset }).toUTC().toISO()!;
	}
	const { tz = 'UTC', flightCheckinLeadHours = 24, documentExpiryLeadDays = 90 } = opts;
	if (kind === 'flight_checkin')
		return DateTime.fromISO(ref, { zone: 'utc' }).minus({ hours: flightCheckinLeadHours }).toUTC().toISO()!;
	return DateTime.fromISO(ref, { zone: tz })
		.set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
		.minus({ days: documentExpiryLeadDays })
		.toUTC()
		.toISO()!;
}

function arm(
	userId: number,
	kind: 'flight_checkin' | 'document_expiry' | 'custom',
	refType: 'segment' | 'document' | 'trip',
	refId: number,
	fireAt: string
) {
	const now = nowIso();
	const status = fireAt > now ? 'pending' : 'sent';
	upsertReminderBySource({ userId, kind, refType, refId, fireAt, status, attempts: 0, sentAt: null });
}

export function upsertRemindersForSegment(seg: Segment) {
	if (seg.type !== 'flight') {
		cancelRemindersFor('segment', seg.id);
		return;
	}
	const trip = tripsRepo.getTripById(seg.tripId);
	if (!trip) return;
	const user = usersRepo.getUserById(trip.ownerId);
	if (!user) return;
	arm(
		trip.ownerId,
		'flight_checkin',
		'segment',
		seg.id,
		computeFireAt('flight_checkin', seg.startAt, {
			flightCheckinLeadHours: Number(user.flight_checkin_lead_hours)
		})
	);
}

export function upsertCustomReminder(
	userId: number,
	refType: 'trip' | 'segment',
	refId: number,
	startAt: string,
	offsetMinutes: number
) {
	const fireAt = computeFireAt('custom', startAt, { customOffsetMinutes: offsetMinutes });
	arm(userId, 'custom', refType, refId, fireAt);
}

export function upsertRemindersForDocument(doc: Doc) {
	if (!doc.expiresOn) {
		cancelRemindersFor('document', doc.id);
		return;
	}
	const user = usersRepo.getUserById(doc.userId);
	const tz = user?.timezone ?? 'UTC';
	const leadDays = Number(user?.document_expiry_lead_days ?? 90);
	arm(
		doc.userId,
		'document_expiry',
		'document',
		doc.id,
		computeFireAt('document_expiry', doc.expiresOn, { tz, documentExpiryLeadDays: leadDays })
	);
}

export function cancelRemindersFor(refType: 'segment' | 'document' | 'trip', refId: number) {
	deleteRemindersForRef(refType, refId);
}

export function listRemindersForUser(userId: number) {
	return listRemindersForUserFromRepo(userId);
}

// Narrow-surface reminder update for MCP clients. Only the three user-safe
// fields are accepted: title, customNote (stored in details), and offsetMinutes.
// The raw remindersRepo.updateReminder can touch scheduler-internal fields
// (status, last_fired_at, attempts, kind, source) which an AI client must
// never mutate.
export function safeUpdateCustomReminder(
	userId: number,
	reminderId: number,
	patch: {
		title?: string;
		customNote?: string;
		offsetMinutes?: number;
	}
) {
	const r = getReminderById(reminderId);
	if (!r || r.userId !== userId) throw error(404, 'Not found');
	if (r.kind !== 'custom') throw error(400, 'Only custom reminders are MCP-editable');
	if (patch.title !== undefined) {
		if (typeof patch.title !== 'string' || patch.title.length > 200) {
			throw error(400, 'title must be a string up to 200 chars');
		}
	}
	if (patch.customNote !== undefined) {
		if (typeof patch.customNote !== 'string' || patch.customNote.length > 1000) {
			throw error(400, 'customNote must be a string up to 1000 chars');
		}
	}
	let newOffset: number | null = null;
	if (patch.offsetMinutes !== undefined) {
		if (!Number.isInteger(patch.offsetMinutes) || patch.offsetMinutes < -10080 || patch.offsetMinutes > 10080) {
			throw error(400, 'offsetMinutes must be an integer between -10080 and 10080');
		}
		newOffset = patch.offsetMinutes;
	}
	// ReminderRow uses `name`, not `title`. The MCP-facing `title` arg
	// maps to the row's `name` column so the user-visible label is updated.
	const safePatch: { name?: string; description?: string | null } = {};
	if (patch.title !== undefined) safePatch.name = patch.title;
	if (patch.customNote !== undefined) {
		// customNote rides on the description column for custom reminders.
		safePatch.description = patch.customNote;
	}
	updateReminder(reminderId, safePatch as Parameters<typeof updateReminder>[1]);
	if (newOffset !== null && r.refType === 'trip') {
		// Re-arm with the trip's start date so the new offset is honored.
		const trip = tripsRepo.getTripById(r.refId);
		if (trip?.startDate) {
			const startAt = `${trip.startDate}T09:00:00Z`;
			arm(userId, 'custom', 'trip', r.refId, computeFireAt('custom', startAt, { customOffsetMinutes: newOffset }));
		}
	}
}

export function cancelReminder(userId: number, reminderId: number) {
	const r = getReminderById(reminderId);
	if (!r || r.userId !== userId) throw error(404, 'Not found');
	deleteReminder(reminderId);
}

/**
 * Max due reminders delivered in a single scheduler tick. Bounding the batch
 * keeps any one tick short even after a backlog builds up (e.g. while SMTP was
 * down); the remainder stays 'pending' and drains across subsequent ticks.
 */
export const MAX_REMINDERS_PER_TICK = 100;

export async function runDueReminders(now: Date): Promise<{ processed: number; sent: number }> {
	// Claim both fresh 'pending' rows and any 'sending' rows orphaned by a prior crash.
	// Ticks never overlap (single process + scheduler running-guard), so any due
	// 'sending' row at tick start is stale and safe to re-grab — at-least-once delivery.
	const claimed = listPendingRemindersBefore(now.toISOString(), MAX_REMINDERS_PER_TICK).filter(
		(r) => r.status === 'pending' || r.status === 'sending'
	);
	let sent = 0;
	for (const r of claimed) {
		updateReminder(r.id, { status: 'sending' });
		try {
			await deliver(r.userId, messageFor(r));
			markReminderSent(r.id, now.toISOString());
			sent++;
		} catch {
			const next = r.attempts >= 5 ? 'sent' : 'pending';
			updateReminder(r.id, { status: next, attempts: r.attempts + 1 });
			if (next === 'sent') sent++;
		}
	}
	return { processed: claimed.length, sent };
}

function messageFor(r: Reminder): { title: string; body: string; link: string } {
	if (r.kind === 'flight_checkin') {
		return {
			title: 'Check-in reminder',
			body: 'A flight you track is departing soon.',
			link: `/trips`
		};
	}
	if (r.kind === 'document_expiry') {
		return {
			title: 'Document expiring',
			body: 'A travel document is expiring soon.',
			link: `/profile/documents`
		};
	}
	return {
		title: 'Reminder',
		body: 'A scheduled reminder is due.',
		link: r.refType === 'trip' ? `/trips/${r.refId}` : `/trips`
	};
}
