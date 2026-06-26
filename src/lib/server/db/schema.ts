import { sqliteTable, integer, text, primaryKey, unique, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { enumCheck } from './schemaHelpers';

export const schedulerRuns = sqliteTable(
	'scheduler_runs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		startedAt: text('started_at').notNull(),
		finishedAt: text('finished_at'),
		success: integer('success', { mode: 'boolean' }).notNull().default(false),
		errorMessage: text('error_message')
	},
	(t) => ({
		startedIdx: index('scheduler_runs_started_idx').on(t.startedAt)
	})
);

const now = sql`(datetime('now'))`;

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const VISIBILITIES = ['private', 'groups', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const TRIP_STATUSES = ['planning', 'booked', 'active', 'completed'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const SHARE_PERMISSIONS = ['read', 'edit'] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

export const CARD_NETWORKS = ['visa', 'mc', 'amex', 'disc', 'other'] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number];

export const BENEFIT_TYPES = ['trip_delay', 'baggage_delay', 'trip_cancellation', 'other'] as const;
export type BenefitType = (typeof BENEFIT_TYPES)[number];

export const REMINDER_KINDS = ['flight_checkin', 'document_expiry', 'custom'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_REF_TYPES = ['segment', 'document', 'trip'] as const;
export type ReminderRefType = (typeof REMINDER_REF_TYPES)[number];

export const REMINDER_STATUSES = ['pending', 'sending', 'sent'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const EXPENSE_CATEGORIES = ['lodging', 'transport', 'food', 'activities', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const WATCH_STATUSES = ['active', 'paused'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const ENTRY_REQUIREMENT_TYPES = ['visa', 'vaccination', 'other'] as const;
export type EntryRequirementType = (typeof ENTRY_REQUIREMENT_TYPES)[number];

export const ENTRY_REQUIREMENT_STATUSES = ['needed', 'in_progress', 'complete', 'not_needed'] as const;
export type EntryRequirementStatus = (typeof ENTRY_REQUIREMENT_STATUSES)[number];

export const users = sqliteTable(
	'users',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash').notNull(),
		displayName: text('display_name').notNull(),
		role: text('role').notNull().default('user'),
		disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
		mustResetPassword: integer('must_reset_password', { mode: 'boolean' }).notNull().default(false),
		timezone: text('timezone').notNull().default('UTC'),
		flightCheckinLeadHours: integer('flight_checkin_lead_hours').notNull().default(24),
		documentExpiryLeadDays: integer('document_expiry_lead_days').notNull().default(90),
		emailNotifications: integer('email_notifications', { mode: 'boolean' }).notNull().default(true),
		webhookNotifications: integer('webhook_notifications', { mode: 'boolean' }).notNull().default(true),
		themeId: text('theme_id').notNull().default('midnight-travels'),
		defaultCurrency: text('default_currency').notNull().default('USD'),
		calendarToken: text('calendar_token').unique(),
		calendarTokenExpiresAt: text('calendar_token_expires_at'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		roleCk: enumCheck(t.role, ROLES, { constraintName: 'users_role_ck' }),
		flightLeadCk: check('users_flight_lead_ck', sql`${t.flightCheckinLeadHours} >= 0`),
		docLeadCk: check('users_doc_lead_ck', sql`${t.documentExpiryLeadDays} >= 0`)
	})
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tokenHash: text('token_hash').notNull().unique(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: text('expires_at').notNull(),
		lastIp: text('last_ip'),
		userAgent: text('user_agent'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		userIdx: index('sessions_user_idx').on(t.userId),
		expiresIdx: index('sessions_expires_idx').on(t.expiresAt)
	})
);

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tokenHash: text('token_hash').notNull().unique(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at').notNull().default(now)
});

export const settings = sqliteTable('settings', {
	id: integer('id').primaryKey(),
	instanceName: text('instance_name').notNull().default('Roamarr'),
	setupComplete: integer('setup_complete', { mode: 'boolean' }).notNull().default(false),
	allowRegistration: integer('allow_registration', { mode: 'boolean' }).notNull().default(false),
	defaultTimezone: text('default_timezone').notNull().default('UTC'),
	defaultCurrency: text('default_currency').notNull().default('USD'),
	defaultFlightCheckinLeadHours: integer('default_flight_checkin_lead_hours').notNull().default(24),
	defaultDocumentExpiryLeadDays: integer('default_document_expiry_lead_days').notNull().default(90),
	smtpHost: text('smtp_host'),
	smtpPort: integer('smtp_port'),
	smtpUser: text('smtp_user'),
	smtpPass: text('smtp_pass'),
	smtpFrom: text('smtp_from'),
	webhookUrl: text('webhook_url')
});

export const trips = sqliteTable(
	'trips',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ownerId: integer('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		destination: text('destination'),
		startDate: text('start_date'),
		endDate: text('end_date'),
		notes: text('notes'),
		tags: text('tags').notNull().default('[]'),
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
		favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
		defaultVisibility: text('default_visibility').notNull().default('private'),
		publicToken: text('public_token').unique(),
		publicTokenExpiresAt: text('public_token_expires_at'),
		publicShowDetails: integer('public_show_details', { mode: 'boolean' }).notNull().default(false),
		calendarToken: text('calendar_token').unique(),
		calendarTokenExpiresAt: text('calendar_token_expires_at'),
		baseCurrency: text('base_currency').notNull().default('USD'),
		status: text('status').notNull().default('booked'),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		visCk: enumCheck(t.defaultVisibility, VISIBILITIES, { constraintName: 'trips_vis_ck' }),
		statusCk: enumCheck(t.status, TRIP_STATUSES, { constraintName: 'trips_status_ck' }),
		ownerIdx: index('trips_owner_idx').on(t.ownerId),
		startIdx: index('trips_start_idx').on(t.startDate)
	})
);

export const tripComments = sqliteTable(
	'trip_comments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('trip_comments_trip_idx').on(t.tripId)
	})
);

export const SEGMENT_TYPES = [
	'flight',
	'event',
	'hotel',
	'rental_car',
	'note',
	'todo',
	'parking',
	'boat',
	'train',
	'directions',
	'food',
	'poi',
	'meetup',
	'rideshare',
	'shuttle'
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const SEGMENT_STATUSES = ['planned', 'checked_in', 'boarded', 'arrived', 'completed'] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

export const SEGMENT_PAYMENT_STATUSES = ['quoted', 'deposit_paid', 'fully_paid', 'refunded'] as const;
export type SegmentPaymentStatus = (typeof SEGMENT_PAYMENT_STATUSES)[number];

export const segments = sqliteTable(
	'segments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		title: text('title').notNull(),
		startAt: text('start_at').notNull(),
		startTz: text('start_tz').notNull().default('UTC'),
		endAt: text('end_at'),
		endTz: text('end_tz'),
		status: text('status').notNull().default('planned'),
		location: text('location'),
		confirmationNumber: text('confirmation_number'),
		detailsJson: text('details_json'),
		meetingPoint: text('meeting_point'),
		meetingAt: text('meeting_at'),
		paymentStatus: text('payment_status').notNull().default('quoted'),
		paymentDueDate: text('payment_due_date'),
		cardId: integer('card_id').references(() => cards.id, { onDelete: 'set null' }),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		typeCk: enumCheck(t.type, SEGMENT_TYPES, { constraintName: 'segments_type_ck' }),
		statusCk: enumCheck(t.status, SEGMENT_STATUSES, { constraintName: 'segments_status_ck' }),
		paymentStatusCk: enumCheck(t.paymentStatus, SEGMENT_PAYMENT_STATUSES, {
			constraintName: 'segments_payment_status_ck'
		}),
		tripIdx: index('segments_trip_idx').on(t.tripId),
		startIdx: index('segments_start_idx').on(t.startAt)
	})
);

export const TRAVEL_DOCUMENT_TYPES = ['passport', 'drivers_license', 'global_entry', 'visa'] as const;
export type TravelDocumentType = (typeof TRAVEL_DOCUMENT_TYPES)[number];

export const travelDocuments = sqliteTable(
	'travel_documents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		companionId: integer('companion_id').references(() => tripCompanions.id, {
			onDelete: 'cascade'
		}),
		type: text('type').notNull(),
		number: text('number'),
		issuingAuthority: text('issuing_authority'),
		expiresOn: text('expires_on'),
		notes: text('notes')
	},
	(t) => ({
		typeCk: enumCheck(t.type, TRAVEL_DOCUMENT_TYPES, { constraintName: 'docs_type_ck' }),
		expIdx: index('docs_user_exp_idx').on(t.userId, t.expiresOn),
		companionIdx: index('docs_companion_idx').on(t.companionId)
	})
);

export const loyaltyPrograms = sqliteTable(
	'loyalty_programs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		programName: text('program_name').notNull(),
		membershipNumber: text('membership_number'),
		balance: integer('balance'),
		notes: text('notes')
	},
	(t) => ({
		userIdx: index('loyalty_user_idx').on(t.userId)
	})
);

export const groups = sqliteTable(
	'groups',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ownerId: integer('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		ownerIdx: index('groups_owner_idx').on(t.ownerId)
	})
);

export const groupMembers = sqliteTable(
	'group_members',
	{
		groupId: integer('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' })
	},
	(t) => ({
		pk: primaryKey({ columns: [t.groupId, t.userId] }),
		userIdx: index('gm_user_idx').on(t.userId)
	})
);

export const tripShares = sqliteTable(
	'trip_shares',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		sharedWithUserId: integer('shared_with_user_id').references(() => users.id, {
			onDelete: 'cascade'
		}),
		sharedWithGroupId: integer('shared_with_group_id').references(() => groups.id, {
			onDelete: 'cascade'
		}),
		permission: text('permission').notNull().default('read'),
		showDetails: integer('show_details', { mode: 'boolean' }).notNull().default(false),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		oneTarget: check(
			'shares_one_target_ck',
			sql`(${t.sharedWithUserId} is not null) <> (${t.sharedWithGroupId} is not null)`
		),
		permCk: enumCheck(t.permission, SHARE_PERMISSIONS, { constraintName: 'shares_perm_ck' }),
		uUser: uniqueIndex('shares_trip_user_uq').on(t.tripId, t.sharedWithUserId),
		uGroup: uniqueIndex('shares_trip_group_uq').on(t.tripId, t.sharedWithGroupId),
		userIdx: index('shares_user_idx').on(t.sharedWithUserId),
		groupIdx: index('shares_group_idx').on(t.sharedWithGroupId)
	})
);

export const cards = sqliteTable(
	'cards',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		nickname: text('nickname').notNull(),
		network: text('network').notNull(),
		last4: text('last4'),
		notes: text('notes')
	},
	(t) => ({
		netCk: enumCheck(t.network, CARD_NETWORKS, { constraintName: 'cards_net_ck' }),
		userIdx: index('cards_user_idx').on(t.userId)
	})
);

export const cardBenefits = sqliteTable(
	'card_benefits',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		cardId: integer('card_id')
			.notNull()
			.references(() => cards.id, { onDelete: 'cascade' }),
		benefitType: text('benefit_type').notNull(),
		coverageAmount: integer('coverage_amount'),
		currency: text('currency').notNull().default('USD'),
		notes: text('notes')
	},
	(t) => ({
		ck: enumCheck(t.benefitType, BENEFIT_TYPES, { constraintName: 'benefit_type_ck' })
	})
);

export const benefitTemplates = sqliteTable(
	'benefit_templates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		benefitType: text('benefit_type').notNull(),
		name: text('name').notNull(),
		coverageAmount: integer('coverage_amount'),
		currency: text('currency').notNull().default('USD'),
		description: text('description')
	},
	(t) => ({
		ck: enumCheck(t.benefitType, BENEFIT_TYPES, { constraintName: 'benefit_template_type_ck' })
	})
);

export const insurancePolicies = sqliteTable(
	'insurance_policies',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		policyNumber: text('policy_number'),
		coverageSummary: text('coverage_summary'),
		coverageAmount: integer('coverage_amount'),
		currency: text('currency').notNull().default('USD'),
		startDate: text('start_date'),
		endDate: text('end_date'),
		tripId: integer('trip_id').references(() => trips.id, { onDelete: 'set null' }),
		notes: text('notes')
	},
	(t) => ({
		userIdx: index('ins_user_idx').on(t.userId),
		tripIdx: index('ins_trip_idx').on(t.tripId)
	})
);

export const fareProviders = sqliteTable(
	'fare_providers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		providerKey: text('provider_key').notNull(),
		label: text('label').notNull().default(''),
		apiKey: text('api_key'),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true)
	},
	(t) => ({
		userIdx: index('fare_providers_user_idx').on(t.userId)
	})
);

export const fareWatches = sqliteTable(
	'fare_watches',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		segmentId: integer('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
		providerId: integer('provider_id')
			.notNull()
			.references(() => fareProviders.id, { onDelete: 'cascade' }),
		status: text('status').notNull().default('active'),
		lastCheckedAt: text('last_checked_at'),
		lastResultJson: text('last_result_json'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		statusCk: enumCheck(t.status, WATCH_STATUSES, { constraintName: 'watch_status_ck' }),
		provIdx: index('watch_provider_idx').on(t.providerId),
		statusIdx: index('watch_status_idx').on(t.status),
		tripIdx: index('watch_trip_idx').on(t.tripId),
		segmentIdx: index('watch_segment_idx').on(t.segmentId)
	})
);

export const reminders = sqliteTable(
	'reminders',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		refType: text('ref_type').notNull(),
		refId: integer('ref_id').notNull(),
		fireAt: text('fire_at').notNull(),
		status: text('status').notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		sentAt: text('sent_at'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		kindCk: enumCheck(t.kind, REMINDER_KINDS, { constraintName: 'rem_kind_ck' }),
		refCk: enumCheck(t.refType, REMINDER_REF_TYPES, { constraintName: 'rem_ref_ck' }),
		statCk: enumCheck(t.status, REMINDER_STATUSES, { constraintName: 'rem_stat_ck' }),
		uq: unique('rem_source_uq').on(t.kind, t.refType, t.refId),
		dueIdx: index('rem_due_idx').on(t.status, t.fireAt)
	})
);

export const notifications = sqliteTable(
	'notifications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		body: text('body').notNull(),
		link: text('link'),
		createdAt: text('created_at').notNull().default(now),
		readAt: text('read_at')
	},
	(t) => ({
		userIdx: index('notif_user_idx').on(t.userId, t.readAt)
	})
);

export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		action: text('action').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: integer('entity_id').notNull(),
		metaJson: text('meta_json').notNull().default('{}'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		userIdx: index('audit_user_idx').on(t.userId),
		entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId)
	})
);

export const COMPANION_CATEGORIES = ['adult', 'child', 'other'] as const;
export type CompanionCategory = (typeof COMPANION_CATEGORIES)[number];

export const SEAT_PREFERENCES = ['aisle', 'window', 'middle', 'none'] as const;
export type SeatPreference = (typeof SEAT_PREFERENCES)[number];

export const BED_PREFERENCES = ['king', 'queen', 'twin', 'two_doubles', 'other'] as const;
export type BedPreference = (typeof BED_PREFERENCES)[number];

export const tripCompanions = sqliteTable(
	'trip_companions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		category: text('category').notNull().default('adult'),
		dietary: text('dietary'),
		allergies: text('allergies'),
		medicalNotes: text('medical_notes'),
		needsCarSeat: integer('needs_car_seat', { mode: 'boolean' }).notNull().default(false),
		needsStroller: integer('needs_stroller', { mode: 'boolean' }).notNull().default(false),
		needsCrib: integer('needs_crib', { mode: 'boolean' }).notNull().default(false),
		needsKidsMeal: integer('needs_kids_meal', { mode: 'boolean' }).notNull().default(false),
		childTicketDiscount: text('child_ticket_discount'),
		seatPreference: text('seat_preference'),
		bedPreference: text('bed_preference'),
		accessibilityNeeds: text('accessibility_needs'),
		roomNotes: text('room_notes'),
		notes: text('notes'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		catCk: enumCheck(t.category, COMPANION_CATEGORIES, { constraintName: 'companions_cat_ck' }),
		seatCk: enumCheck(t.seatPreference, SEAT_PREFERENCES, {
			nullable: true,
			constraintName: 'companions_seat_ck'
		}),
		bedCk: enumCheck(t.bedPreference, BED_PREFERENCES, {
			nullable: true,
			constraintName: 'companions_bed_ck'
		}),
		tripIdx: index('companions_trip_idx').on(t.tripId)
	})
);

export const tripChecklists = sqliteTable(
	'trip_checklists',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: uniqueIndex('checklist_trip_uq').on(t.tripId)
	})
);

export const tripChecklistItems = sqliteTable(
	'trip_checklist_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		checklistId: integer('checklist_id')
			.notNull()
			.references(() => tripChecklists.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		packed: integer('packed', { mode: 'boolean' }).notNull().default(false),
		assignedToCompanionId: integer('assigned_to_companion_id').references(() => tripCompanions.id, {
			onDelete: 'set null'
		}),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		checklistIdx: index('checklist_items_checklist_idx').on(t.checklistId)
	})
);

export const tripExpenses = sqliteTable(
	'trip_expenses',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		description: text('description').notNull(),
		amount: integer('amount').notNull(),
		currency: text('currency').notNull().default('USD'),
		category: text('category').default('other'),
		exchangeRate: integer('exchange_rate').notNull().default(10000),
		baseAmount: integer('base_amount').notNull().default(0),
		paidByCompanionId: integer('paid_by_companion_id').references(() => tripCompanions.id, {
			onDelete: 'set null'
		}),
		splitAmong: text('split_among').notNull().default('[]'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('expenses_trip_idx').on(t.tripId),
		catCk: enumCheck(t.category, EXPENSE_CATEGORIES, { constraintName: 'expenses_category_ck' })
	})
);

export const SEGMENT_ATTENDEE_STATUSES = ['going', 'maybe', 'not_going'] as const;
export type SegmentAttendeeStatus = (typeof SEGMENT_ATTENDEE_STATUSES)[number];

export const segmentAttendees = sqliteTable(
	'segment_attendees',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		segmentId: integer('segment_id')
			.notNull()
			.references(() => segments.id, { onDelete: 'cascade' }),
		companionId: integer('companion_id')
			.notNull()
			.references(() => tripCompanions.id, { onDelete: 'cascade' }),
		status: text('status').notNull().default('going'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		statusCk: enumCheck(t.status, SEGMENT_ATTENDEE_STATUSES, {
			constraintName: 'attendee_status_ck'
		}),
		uq: unique('attendee_segment_companion_uq').on(t.segmentId, t.companionId),
		segmentIdx: index('attendees_segment_idx').on(t.segmentId)
	})
);

export const emergencyContacts = sqliteTable(
	'emergency_contacts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		relationship: text('relationship'),
		phone: text('phone'),
		email: text('email'),
		isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		userIdx: index('emergency_contacts_user_idx').on(t.userId)
	})
);

export const tripJournalEntries = sqliteTable(
	'trip_journal_entries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		entryDate: text('entry_date').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('journal_trip_idx').on(t.tripId)
	})
);

export const tripDocumentLinks = sqliteTable(
	'trip_document_links',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		url: text('url').notNull(),
		notes: text('notes'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('doc_links_trip_idx').on(t.tripId)
	})
);

export const packingTemplates = sqliteTable(
	'packing_templates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		userIdx: index('packing_templates_user_idx').on(t.userId)
	})
);

export const packingTemplateItems = sqliteTable(
	'packing_template_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		templateId: integer('template_id')
			.notNull()
			.references(() => packingTemplates.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		category: text('category').notNull().default('general'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		templateIdx: index('packing_template_items_template_idx').on(t.templateId)
	})
);

export const tripPolls = sqliteTable(
	'trip_polls',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		question: text('question').notNull(),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('trip_polls_trip_idx').on(t.tripId)
	})
);

export const tripPollOptions = sqliteTable(
	'trip_poll_options',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		pollId: integer('poll_id')
			.notNull()
			.references(() => tripPolls.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		pollIdx: index('trip_poll_options_poll_idx').on(t.pollId)
	})
);

export const tripPollVotes = sqliteTable(
	'trip_poll_votes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		pollId: integer('poll_id')
			.notNull()
			.references(() => tripPolls.id, { onDelete: 'cascade' }),
		optionId: integer('option_id')
			.notNull()
			.references(() => tripPollOptions.id, { onDelete: 'cascade' }),
		companionId: integer('companion_id')
			.notNull()
			.references(() => tripCompanions.id, { onDelete: 'cascade' }),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		uq: unique('trip_poll_votes_poll_companion_uq').on(t.pollId, t.companionId),
		pollIdx: index('trip_poll_votes_poll_idx').on(t.pollId)
	})
);

export const tripBudgetCategories = sqliteTable(
	'trip_budget_categories',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		category: text('category').notNull(),
		amount: integer('amount').notNull(),
		currency: text('currency').notNull().default('USD'),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		uq: unique('trip_budget_categories_trip_category_uq').on(t.tripId, t.category),
		tripIdx: index('trip_budget_categories_trip_idx').on(t.tripId)
	})
);

export const tripExpenseAttachments = sqliteTable(
	'trip_expense_attachments',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		expenseId: integer('expense_id')
			.notNull()
			.references(() => tripExpenses.id, { onDelete: 'cascade' }),
		filename: text('filename').notNull(),
		storageKey: text('storage_key').notNull().unique(),
		contentType: text('content_type').notNull(),
		sizeBytes: integer('size_bytes').notNull().default(0),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		expenseIdx: index('expense_attachments_expense_idx').on(t.expenseId)
	})
);

export const tripTemplates = sqliteTable(
	'trip_templates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		sourceTripId: integer('source_trip_id').references(() => trips.id, { onDelete: 'set null' }),
		snapshotJson: text('snapshot_json').notNull(),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		userIdx: index('trip_templates_user_idx').on(t.userId),
		sourceIdx: index('trip_templates_source_idx').on(t.sourceTripId)
	})
);

export const tripHomeTasks = sqliteTable(
	'trip_home_tasks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		dueDate: text('due_date'),
		done: integer('done', { mode: 'boolean' }).notNull().default(false),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('home_tasks_trip_idx').on(t.tripId)
	})
);

export const tripMedications = sqliteTable(
	'trip_medications',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		companionId: integer('companion_id').references(() => tripCompanions.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		dosage: text('dosage'),
		schedule: text('schedule'),
		startsAt: text('starts_at'),
		endsAt: text('ends_at'),
		notes: text('notes'),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('medications_trip_idx').on(t.tripId),
		companionIdx: index('medications_companion_idx').on(t.companionId)
	})
);

export const tripEntryRequirements = sqliteTable(
	'trip_entry_requirements',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		country: text('country').notNull(),
		requirementType: text('requirement_type').notNull(),
		status: text('status').notNull().default('needed'),
		dueDate: text('due_date'),
		notes: text('notes'),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		typeCk: enumCheck(t.requirementType, ENTRY_REQUIREMENT_TYPES, {
			constraintName: 'entry_req_type_ck'
		}),
		statusCk: enumCheck(t.status, ENTRY_REQUIREMENT_STATUSES, {
			constraintName: 'entry_req_status_ck'
		}),
		tripIdx: index('entry_req_trip_idx').on(t.tripId)
	})
);

export const tripImportantItems = sqliteTable(
	'trip_important_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tripId: integer('trip_id')
			.notNull()
			.references(() => trips.id, { onDelete: 'cascade' }),
		companionId: integer('companion_id').references(() => tripCompanions.id, {
			onDelete: 'set null'
		}),
		name: text('name').notNull(),
		serialNumber: text('serial_number'),
		trackerId: text('tracker_id'),
		notes: text('notes'),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		tripIdx: index('important_items_trip_idx').on(t.tripId),
		companionIdx: index('important_items_companion_idx').on(t.companionId)
	})
);
