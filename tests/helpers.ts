import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/createDb';
import { applyMigrations } from '../src/lib/server/db/migrate';
import {
	settings,
	users,
	trips,
	segments,
	tripCompanions,
	groups,
	groupMembers,
	tripShares,
	cards,
	insurancePolicies,
	travelDocuments,
	fareProviders,
	fareWatches,
	reminders,
	notifications,
	tripExpenses,
	tripExpenseAttachments,
	schedulerRuns
} from '../src/lib/server/db/schema';
import {
	users as kitUsers,
	trips as kitTrips,
	segments as kitSegments,
	tripCompanions as kitTripCompanions,
	groups as kitGroups,
	groupMembers as kitGroupMembers,
	tripShares as kitTripShares,
	cards as kitCards,
	insurancePolicies as kitInsurancePolicies,
	travelDocuments as kitTravelDocuments,
	fareProviders as kitFareProviders,
	fareWatches as kitFareWatches,
	reminders as kitReminders,
	notifications as kitNotifications,
	tripExpenses as kitTripExpenses,
	tripExpenseAttachments as kitTripExpenseAttachments,
	schedulerRuns as kitSchedulerRuns
} from '../src/lib/server/db/mongrelSchema';
import { KitDatabase } from '@mongreldb/kit';
import { schema as kitSchema } from '../src/lib/server/db/mongrelSchema';
import { migrations as kitMigrations } from '../src/lib/server/db/mongrelMigrations/0001_initial';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database } from 'better-sqlite3';

let userCounter = 0;
let tripCounter = 0;
function allocId(): number {
	// Random high id avoids collisions when the helpers module is reloaded
	// between tests while the in-memory database persists.
	return 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
}

export function freshDb() {
	const { db, sqlite } = createDb(':memory:');
	applyMigrations(db);
	db.insert(settings).values({ id: 1 }).run();

	// Also provide a fresh MongrelDB Kit instance for code that has migrated to
	// the kit singleton. The temp directory is removed on process exit.
	const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-test-'));
	const kitInstance = KitDatabase.openSync(dir, kitSchema);
	kitInstance.migrateSync(kitSchema, kitMigrations);

	const close = () => {
		kitInstance.close();
		rmSync(dir, { recursive: true, force: true });
	};
	const cleanup = () => {
		try {
			close();
		} catch {
			/* best-effort cleanup */
		}
	};
	process.once('exit', cleanup);

	return { db, sqlite, kit: kitInstance, getDb: () => kitInstance, dir, close };
}

export function freshKitDb() {
	const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-test-'));
	const kitInstance = KitDatabase.openSync(dir, kitSchema);
	kitInstance.migrateSync(kitSchema, kitMigrations);
	return {
		kit: kitInstance,
		close: () => {
			kitInstance.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

export function resetTables(sqlite: Database, ...tables: string[]) {
	sqlite.exec(tables.map((t) => `delete from ${t};`).join(' '));
}

function nullableFk(id: bigint | null | undefined): number | null {
	if (id == null || id === 0n) return null;
	return Number(id);
}

function serializeJson(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

// Users

export function makeUser(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof users.$inferInsert> = {}
) {
	const n = userCounter++;
	const id = allocId();
	const row = kit.insertInto(kitUsers).values({
		id: BigInt(id),
		email: over.email ?? `u${n}@x.c`,
		password_hash: over.passwordHash ?? 'x',
		display_name: over.displayName ?? `U${n}`,
		role: (over.role as any) ?? 'user',
		disabled: over.disabled ?? false,
		must_reset_password: over.mustResetPassword ?? false,
		timezone: over.timezone ?? 'UTC',
		flight_checkin_lead_hours:
			over.flightCheckinLeadHours != null ? BigInt(over.flightCheckinLeadHours) : undefined,
		document_expiry_lead_days:
			over.documentExpiryLeadDays != null ? BigInt(over.documentExpiryLeadDays) : undefined,
		email_notifications: over.emailNotifications,
		webhook_notifications: over.webhookNotifications,
		theme_id: over.themeId,
		default_currency: over.defaultCurrency,
		calendar_token: over.calendarToken ?? `cal-user-${id}`,
		calendar_token_expires_at: over.calendarTokenExpiresAt ?? null
	} as never).executeSync();
	db.insert(users)
		.values({
			id,
			email: row.email,
			passwordHash: row.password_hash,
			displayName: row.display_name,
			role: row.role,
			disabled: row.disabled,
			mustResetPassword: row.must_reset_password,
			timezone: row.timezone,
			flightCheckinLeadHours: Number(row.flight_checkin_lead_hours),
			documentExpiryLeadDays: Number(row.document_expiry_lead_days),
			emailNotifications: row.email_notifications,
			webhookNotifications: row.webhook_notifications,
			themeId: row.theme_id,
			defaultCurrency: row.default_currency,
			calendarToken: row.calendar_token,
			calendarTokenExpiresAt: row.calendar_token_expires_at,
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(users).where(eq(users.id, id)).get()!;
}

export function makeAdmin(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof users.$inferInsert> = {}
) {
	return makeUser(db, kit, { ...over, role: 'admin' });
}

// Trips

export function makeTrip(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	ownerId: number,
	over: Partial<typeof trips.$inferInsert> = {}
) {
	const n = tripCounter++;
	const id = allocId();
	const row = kit.insertInto(kitTrips).values({
		id: BigInt(id),
		owner_id: BigInt(ownerId),
		name: over.name ?? `Test Trip ${n}`,
		destination: over.destination ?? null,
		destination_country_code: over.destinationCountryCode ?? null,
		destination_city_name: over.destinationCityName ?? null,
		destination_city_lat: over.destinationCityLat ?? null,
		destination_city_lng: over.destinationCityLng ?? null,
		start_date: over.startDate ?? null,
		end_date: over.endDate ?? null,
		notes: over.notes ?? null,
		tags: over.tags ?? '[]',
		archived: over.archived ?? false,
		favorite: over.favorite ?? false,
		default_visibility: (over.defaultVisibility as any) ?? 'private',
		public_token: over.publicToken ?? `pub-trip-${id}`,
		public_token_expires_at: over.publicTokenExpiresAt ?? null,
		public_show_details: over.publicShowDetails ?? false,
		calendar_token: over.calendarToken ?? `cal-trip-${id}`,
		calendar_token_expires_at: over.calendarTokenExpiresAt ?? null,
		base_currency: over.baseCurrency ?? 'USD',
		status: (over.status as any) ?? 'booked'
	} as never).executeSync();
	db.insert(trips)
		.values({
			id,
			ownerId,
			name: row.name,
			destination: row.destination,
			destinationCountryCode: row.destination_country_code,
			destinationCityName: row.destination_city_name,
			destinationCityLat: row.destination_city_lat,
			destinationCityLng: row.destination_city_lng,
			startDate: row.start_date,
			endDate: row.end_date,
			notes: row.notes,
			tags: row.tags,
			archived: row.archived,
			favorite: row.favorite,
			defaultVisibility: row.default_visibility,
			publicToken: row.public_token,
			publicTokenExpiresAt: row.public_token_expires_at,
			publicShowDetails: row.public_show_details,
			calendarToken: row.calendar_token,
			calendarTokenExpiresAt: row.calendar_token_expires_at,
			baseCurrency: row.base_currency,
			status: row.status,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		} as never)
		.run();
	return db.select().from(trips).where(eq(trips.id, id)).get()!;
}

// Segments

export function makeSegment(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	tripId: number,
	over: Partial<typeof segments.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitSegments).values({
		id: BigInt(id),
		trip_id: BigInt(tripId),
		type: (over.type as any) ?? 'flight',
		title: over.title ?? 'Segment',
		start_at: over.startAt ?? new Date().toISOString(),
		start_tz: (over.startTz as any) ?? 'UTC',
		end_at: over.endAt ?? null,
		end_tz: over.endTz ?? null,
		status: (over.status as any) ?? 'planned',
		location: over.location ?? null,
		country_code: over.countryCode ?? null,
		city_name: over.cityName ?? null,
		city_lat: over.cityLat ?? null,
		city_lng: over.cityLng ?? null,
		venue: over.venue ?? null,
		confirmation_number: over.confirmationNumber ?? null,
		details_json: serializeJson(over.detailsJson) as any,
		meeting_point: over.meetingPoint ?? null,
		meeting_at: over.meetingAt ?? null,
		payment_status: (over.paymentStatus as any) ?? 'quoted',
		payment_due_date: over.paymentDueDate ?? null,
		card_id: over.cardId ? BigInt(over.cardId) : null
	} as never).executeSync();
	db.insert(segments)
		.values({
			id,
			tripId,
			type: row.type,
			title: row.title,
			startAt: row.start_at,
			startTz: row.start_tz,
			endAt: row.end_at,
			endTz: row.end_tz,
			status: row.status,
			location: row.location,
			countryCode: row.country_code,
			cityName: row.city_name,
			cityLat: row.city_lat,
			cityLng: row.city_lng,
			venue: row.venue,
			confirmationNumber: row.confirmation_number,
			detailsJson: serializeJson(row.details_json),
			meetingPoint: row.meeting_point,
			meetingAt: row.meeting_at,
			paymentStatus: row.payment_status,
			paymentDueDate: row.payment_due_date,
			cardId: nullableFk(row.card_id),
			createdAt: row.created_at,
			updatedAt: row.updated_at
		} as never)
		.run();
	return db.select().from(segments).where(eq(segments.id, id)).get()!;
}

// Companions

export function makeCompanion(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	tripId: number,
	over: Partial<typeof tripCompanions.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitTripCompanions).values({
		id: BigInt(id),
		trip_id: BigInt(tripId),
		name: over.name ?? 'Companion',
		category: (over.category as any) ?? 'adult',
		dietary: over.dietary ?? null,
		allergies: over.allergies ?? null,
		medical_notes: over.medicalNotes ?? null,
		needs_car_seat: over.needsCarSeat ?? false,
		needs_stroller: over.needsStroller ?? false,
		needs_crib: over.needsCrib ?? false,
		needs_kids_meal: over.needsKidsMeal ?? false,
		child_ticket_discount: over.childTicketDiscount ?? null,
		seat_preference: (over.seatPreference as any) ?? null,
		bed_preference: (over.bedPreference as any) ?? null,
		accessibility_needs: over.accessibilityNeeds ?? null,
		room_notes: over.roomNotes ?? null,
		notes: over.notes ?? null
	} as never).executeSync();
	db.insert(tripCompanions)
		.values({
			id,
			tripId,
			name: row.name,
			category: row.category,
			notes: row.notes,
			dietary: row.dietary,
			allergies: row.allergies,
			medicalNotes: row.medical_notes,
			needsCarSeat: row.needs_car_seat,
			needsStroller: row.needs_stroller,
			needsCrib: row.needs_crib,
			needsKidsMeal: row.needs_kids_meal,
			childTicketDiscount: row.child_ticket_discount,
			seatPreference: row.seat_preference,
			bedPreference: row.bed_preference,
			accessibilityNeeds: row.accessibility_needs,
			roomNotes: row.room_notes,
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(tripCompanions).where(eq(tripCompanions.id, id)).get()!;
}

// Groups and members

export function makeGroup(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	ownerId: number,
	name: string
) {
	const id = allocId();
	const row = kit
		.insertInto(kitGroups)
		.values({ id: BigInt(id), owner_id: BigInt(ownerId), name: name.trim() } as never)
		.executeSync();
	db.insert(groups)
		.values({
			id,
			ownerId,
			name: row.name,
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(groups).where(eq(groups.id, id)).get()!;
}

export function makeGroupMember(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	groupId: number,
	userId: number
) {
	kit.insertInto(kitGroupMembers).values({
		group_id: BigInt(groupId),
		user_id: BigInt(userId)
	} as never).executeSync();
	db.insert(groupMembers).values({ groupId, userId } as never).run();
	return { groupId, userId };
}

// Shares

export function makeShare(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	input: {
		tripId: number;
		sharedWithUserId?: number | null;
		sharedWithGroupId?: number | null;
		permission?: 'read' | 'edit';
		showDetails?: boolean;
	}
) {
	const id = allocId();
	const sharedWithUserId = input.sharedWithUserId ?? null;
	const sharedWithGroupId = input.sharedWithGroupId ?? null;
	const row = kit.insertInto(kitTripShares).values({
		id: BigInt(id),
		trip_id: BigInt(input.tripId),
		shared_with_user_id: sharedWithUserId != null ? BigInt(sharedWithUserId) : null,
		shared_with_group_id: sharedWithGroupId != null ? BigInt(sharedWithGroupId) : null,
		permission: input.permission ?? 'read',
		show_details: input.showDetails ?? false
	} as never).executeSync();
	db.insert(tripShares)
		.values({
			id,
			tripId: input.tripId,
			sharedWithUserId,
			sharedWithGroupId,
			permission: row.permission,
			showDetails: row.show_details,
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(tripShares).where(eq(tripShares.id, id)).get()!;
}

// Cards

export function makeCard(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	userId: number,
	over: Partial<typeof cards.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitCards).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		nickname: over.nickname ?? 'Card',
		network: (over.network as any) ?? 'visa',
		last4: over.last4 ?? null,
		notes: over.notes ?? null
	} as never).executeSync();
	db.insert(cards)
		.values({
			id,
			userId,
			nickname: row.nickname,
			network: row.network,
			last4: row.last4,
			notes: row.notes
		} as never)
		.run();
	return db.select().from(cards).where(eq(cards.id, id)).get()!;
}

// Insurance policies

export function makeInsurancePolicy(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	userId: number,
	over: Partial<typeof insurancePolicies.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitInsurancePolicies).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		provider: over.provider ?? 'Provider',
		policy_number: over.policyNumber ?? null,
		coverage_summary: over.coverageSummary ?? null,
		coverage_amount: over.coverageAmount != null ? BigInt(over.coverageAmount) : null,
		currency: over.currency ?? 'USD',
		start_date: over.startDate ?? null,
		end_date: over.endDate ?? null,
		trip_id: over.tripId ? BigInt(over.tripId) : null,
		notes: over.notes ?? null
	} as never).executeSync();
	db.insert(insurancePolicies)
		.values({
			id,
			userId,
			provider: row.provider,
			policyNumber: row.policy_number,
			coverageSummary: row.coverage_summary,
			coverageAmount: nullableFk(row.coverage_amount),
			currency: row.currency,
			startDate: row.start_date,
			endDate: row.end_date,
			tripId: nullableFk(row.trip_id),
			notes: row.notes
		} as never)
		.run();
	return db.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).get()!;
}

// Travel documents

export function makeTravelDocument(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	userId: number,
	over: Partial<typeof travelDocuments.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitTravelDocuments).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		companion_id: over.companionId ? BigInt(over.companionId) : null,
		type: (over.type as any) ?? 'passport',
		number: over.number ?? null,
		issuing_authority: over.issuingAuthority ?? null,
		expires_on: over.expiresOn ?? null,
		notes: over.notes ?? null
	} as never).executeSync();
	db.insert(travelDocuments)
		.values({
			id,
			userId,
			companionId: nullableFk(row.companion_id),
			type: row.type,
			number: row.number,
			issuingAuthority: row.issuing_authority,
			expiresOn: row.expires_on,
			notes: row.notes
		} as never)
		.run();
	return db.select().from(travelDocuments).where(eq(travelDocuments.id, id)).get()!;
}

// Fare providers and watches

export function makeFareProvider(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	userId: number,
	over: Partial<typeof fareProviders.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitFareProviders).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		provider_key: over.providerKey ?? 'stub',
		label: over.label ?? '',
		api_key: over.apiKey ?? null,
		enabled: over.enabled ?? true
	} as never).executeSync();
	db.insert(fareProviders)
		.values({
			id,
			userId,
			providerKey: over.providerKey ?? 'stub',
			label: over.label ?? '',
			apiKey: over.apiKey ?? null,
			enabled: over.enabled ?? true
		} as never)
		.run();
	return db.select().from(fareProviders).where(eq(fareProviders.id, id)).get()!;
}

export function makeFareWatch(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	input: {
		tripId: number;
		providerId: number;
		segmentId?: number | null;
		status?: 'active' | 'paused';
	}
) {
	const id = allocId();
	const row = kit.insertInto(kitFareWatches).values({
		id: BigInt(id),
		trip_id: BigInt(input.tripId),
		provider_id: BigInt(input.providerId),
		segment_id: input.segmentId != null ? BigInt(input.segmentId) : null,
		status: input.status ?? 'active'
	} as never).executeSync();
	db.insert(fareWatches)
		.values({
			id,
			tripId: input.tripId,
			providerId: input.providerId,
			segmentId: input.segmentId ?? null,
			status: row.status,
			lastCheckedAt: null,
			lastResultJson: null,
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(fareWatches).where(eq(fareWatches.id, id)).get()!;
}

// Notifications and reminders

export function makeNotification(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	userId: number,
	over: Partial<typeof notifications.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitNotifications).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		title: over.title ?? 'Notification',
		body: over.body ?? 'Body',
		link: over.link ?? null
	} as never).executeSync();
	db.insert(notifications)
		.values({
			id,
			userId,
			title: row.title,
			body: row.body,
			link: row.link,
			createdAt: row.created_at,
			readAt: row.read_at
		} as never)
		.run();
	return db.select().from(notifications).where(eq(notifications.id, id)).get()!;
}

export function makeReminder(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof reminders.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitReminders).values({
		id: BigInt(id),
		user_id: BigInt(over.userId ?? 0),
		kind: (over.kind as any) ?? 'custom',
		ref_type: (over.refType as any) ?? 'trip',
		ref_id: BigInt(over.refId ?? 0),
		fire_at: over.fireAt ?? new Date().toISOString(),
		status: (over.status as any) ?? 'pending',
		attempts: BigInt(over.attempts ?? 0),
		sent_at: over.sentAt ?? null
	} as never).executeSync();
	db.insert(reminders)
		.values({
			id,
			userId: Number(row.user_id),
			kind: row.kind,
			refType: row.ref_type,
			refId: Number(row.ref_id),
			fireAt: row.fire_at,
			status: row.status,
			attempts: Number(row.attempts),
			sentAt: row.sent_at,
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(reminders).where(eq(reminders.id, id)).get()!;
}

// Expenses and attachments

export function makeExpense(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof tripExpenses.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitTripExpenses).values({
		id: BigInt(id),
		trip_id: BigInt(over.tripId ?? 0),
		description: over.description ?? 'Expense',
		amount: BigInt(over.amount ?? 0),
		currency: over.currency ?? 'USD',
		category: (over.category as any) ?? null,
		exchange_rate: BigInt(over.exchangeRate ?? 10000),
		base_amount: BigInt(over.baseAmount ?? 0),
		paid_by_companion_id: over.paidByCompanionId ? BigInt(over.paidByCompanionId) : null,
		split_among: serializeJson(over.splitAmong) ?? '[]'
	} as never).executeSync();
	db.insert(tripExpenses)
		.values({
			id,
			tripId: Number(row.trip_id),
			description: row.description,
			amount: Number(row.amount),
			currency: row.currency,
			category: row.category,
			exchangeRate: Number(row.exchange_rate),
			baseAmount: Number(row.base_amount),
			paidByCompanionId: nullableFk(row.paid_by_companion_id),
			splitAmong: serializeJson(row.split_among),
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(tripExpenses).where(eq(tripExpenses.id, id)).get()!;
}

export function makeAttachment(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof tripExpenseAttachments.$inferInsert> = {}
) {
	const id = allocId();
	const row = kit.insertInto(kitTripExpenseAttachments).values({
		id: BigInt(id),
		expense_id: BigInt(over.expenseId ?? 0),
		filename: over.filename ?? 'file.png',
		storage_key: over.storageKey ?? 'key',
		content_type: over.contentType ?? 'image/png',
		size_bytes: BigInt(over.sizeBytes ?? 0)
	} as never).executeSync();
	db.insert(tripExpenseAttachments)
		.values({
			id,
			expenseId: Number(row.expense_id),
			filename: row.filename,
			storageKey: row.storage_key,
			contentType: row.content_type,
			sizeBytes: Number(row.size_bytes),
			createdAt: row.created_at
		} as never)
		.run();
	return db.select().from(tripExpenseAttachments).where(eq(tripExpenseAttachments.id, id)).get()!;
}

// Scheduler runs

export function makeSchedulerRun(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof schedulerRuns.$inferInsert> = {}
) {
	const id = allocId();
	const now = new Date().toISOString();
	const row = kit.insertInto(kitSchedulerRuns).values({
		id: BigInt(id),
		started_at: over.startedAt ?? now,
		finished_at: over.finishedAt ?? null,
		success: over.success ?? false,
		error_message: over.errorMessage ?? null
	} as never).executeSync();
	db.insert(schedulerRuns)
		.values({
			id,
			startedAt: row.started_at,
			finishedAt: row.finished_at,
			success: row.success,
			errorMessage: row.error_message
		} as never)
		.run();
	return db.select().from(schedulerRuns).where(eq(schedulerRuns.id, id)).get()!;
}

// Backwards-compatible wrappers used by tests that were migrated earlier. They
// keep the old (db, kit, over) signature while delegating to the canonical
// helpers above.

export function makeSyncedUser(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof users.$inferInsert> = {}
) {
	return makeUser(db, kit, over);
}

export function makeSyncedTrip(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof trips.$inferInsert> = {}
) {
	return makeTrip(db, kit, over.ownerId ?? 0, over);
}

export function makeSyncedCompanion(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof tripCompanions.$inferInsert> = {}
) {
	return makeCompanion(db, kit, over.tripId ?? 0, over);
}
