import { DateTime } from 'luxon';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db';
import { reminders, segments, travelDocuments, trips, users } from './db/schema';
import { deliver } from './notify';
import { nowIso } from './tz';

type Seg = typeof segments.$inferSelect;
type Doc = typeof travelDocuments.$inferSelect;
type Reminder = typeof reminders.$inferSelect;

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
	db.insert(reminders)
		.values({ userId, kind, refType, refId, fireAt, status })
		.onConflictDoUpdate({
			target: [reminders.kind, reminders.refType, reminders.refId],
			set: {
				fireAt,
				status: sql`case when ${fireAt} > ${now} then 'pending' else 'sent' end`,
				attempts: 0,
				sentAt: null
			}
		})
		.run();
}

export function upsertRemindersForSegment(seg: Seg) {
	if (seg.type !== 'flight') {
		cancelRemindersFor('segment', seg.id);
		return;
	}
	const owner = db
		.select({ ownerId: trips.ownerId })
		.from(trips)
		.where(eq(trips.id, seg.tripId))
		.get()!;
	const user = db
		.select({ flightCheckinLeadHours: users.flightCheckinLeadHours })
		.from(users)
		.where(eq(users.id, owner.ownerId))
		.get()!;
	arm(
		owner.ownerId,
		'flight_checkin',
		'segment',
		seg.id,
		computeFireAt('flight_checkin', seg.startAt, { flightCheckinLeadHours: user.flightCheckinLeadHours })
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
	const user = db
		.select({ timezone: users.timezone, documentExpiryLeadDays: users.documentExpiryLeadDays })
		.from(users)
		.where(eq(users.id, doc.userId))
		.get();
	const tz = user?.timezone ?? 'UTC';
	const leadDays = user?.documentExpiryLeadDays ?? 90;
	arm(
		doc.userId,
		'document_expiry',
		'document',
		doc.id,
		computeFireAt('document_expiry', doc.expiresOn, { tz, documentExpiryLeadDays: leadDays })
	);
}

export function cancelRemindersFor(refType: 'segment' | 'document' | 'trip', refId: number) {
	db.delete(reminders)
		.where(and(eq(reminders.refType, refType), eq(reminders.refId, refId)))
		.run();
}

export function listRemindersForUser(userId: number) {
	return db
		.select()
		.from(reminders)
		.where(eq(reminders.userId, userId))
		.orderBy(desc(reminders.fireAt))
		.all();
}

export function cancelReminder(userId: number, reminderId: number) {
	const r = db.select().from(reminders).where(eq(reminders.id, reminderId)).get();
	if (!r || r.userId !== userId) throw error(404, 'Not found');
	db.delete(reminders).where(eq(reminders.id, reminderId)).run();
}

export async function runDueReminders(now: Date) {
	// Claim both fresh 'pending' rows and any 'sending' rows orphaned by a prior crash.
	// Ticks never overlap (single process + scheduler running-guard), so any due
	// 'sending' row at tick start is stale and safe to re-grab — at-least-once delivery.
	const claimed = db
		.update(reminders)
		.set({ status: 'sending' })
		.where(
			and(inArray(reminders.status, ['pending', 'sending']), lte(reminders.fireAt, now.toISOString()))
		)
		.returning()
		.all();
	for (const r of claimed) {
		try {
			await deliver(r.userId, messageFor(r));
			db.update(reminders)
				.set({ status: 'sent', sentAt: now.toISOString() })
				.where(eq(reminders.id, r.id))
				.run();
		} catch {
			const next = r.attempts >= 5 ? 'sent' : 'pending';
			db.update(reminders)
				.set({ status: next, attempts: r.attempts + 1 })
				.where(eq(reminders.id, r.id))
				.run();
		}
	}
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
