import { sqliteTable, integer, text, primaryKey, unique, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

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
		createdAt: text('created_at').notNull().default(now)
	},
	(t) => ({
		roleCk: check('users_role_ck', sql`${t.role} in ('admin','user')`),
		flightLeadCk: check('users_flight_lead_ck', sql`${t.flightCheckinLeadHours} >= 0`),
		docLeadCk: check('users_doc_lead_ck', sql`${t.documentExpiryLeadDays} >= 0`)
	})
);

export const sessions = sqliteTable('sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tokenHash: text('token_hash').notNull().unique(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: text('expires_at').notNull(),
	createdAt: text('created_at').notNull().default(now)
});

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
		defaultVisibility: text('default_visibility').notNull().default('private'),
		publicToken: text('public_token').unique(),
		calendarToken: text('calendar_token').unique(),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		visCk: check('trips_vis_ck', sql`${t.defaultVisibility} in ('private','groups','public')`),
		ownerIdx: index('trips_owner_idx').on(t.ownerId),
		startIdx: index('trips_start_idx').on(t.startDate)
	})
);

export const SEGMENT_TYPES = [
	'flight',
	'lodging',
	'car',
	'rail',
	'activity',
	'cruise',
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
		location: text('location'),
		confirmationNumber: text('confirmation_number'),
		detailsJson: text('details_json'),
		cardId: integer('card_id').references(() => cards.id, { onDelete: 'set null' }),
		createdAt: text('created_at').notNull().default(now),
		updatedAt: text('updated_at').notNull().default(now)
	},
	(t) => ({
		typeCk: check(
			'segments_type_ck',
			sql`${t.type} in ('flight','lodging','car','rail','activity','cruise','event','hotel','rental_car','note','todo','parking','boat','train','directions','food','poi','meetup','rideshare','shuttle')`
		),
		tripIdx: index('segments_trip_idx').on(t.tripId),
		startIdx: index('segments_start_idx').on(t.startAt)
	})
);

export const travelDocuments = sqliteTable(
	'travel_documents',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		number: text('number'),
		issuingAuthority: text('issuing_authority'),
		expiresOn: text('expires_on'),
		notes: text('notes')
	},
	(t) => ({
		typeCk: check('docs_type_ck', sql`${t.type} in ('passport','drivers_license','global_entry')`),
		expIdx: index('docs_user_exp_idx').on(t.userId, t.expiresOn)
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

export const groups = sqliteTable('groups', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	createdAt: text('created_at').notNull().default(now)
});

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
		permCk: check('shares_perm_ck', sql`${t.permission} in ('read','edit')`),
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
		netCk: check('cards_net_ck', sql`${t.network} in ('visa','mc','amex','disc','other')`),
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
		ck: check(
			'benefit_type_ck',
			sql`${t.benefitType} in ('trip_delay','baggage_delay','trip_cancellation','other')`
		)
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
		ck: check(
			'benefit_template_type_ck',
			sql`${t.benefitType} in ('trip_delay','baggage_delay','trip_cancellation','other')`
		)
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
		tripIdx: index('ins_trip_idx').on(t.tripId)
	})
);

export const fareProviders = sqliteTable('fare_providers', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	providerKey: text('provider_key').notNull(),
	label: text('label').notNull().default(''),
	apiKey: text('api_key'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	configJson: text('config_json')
});

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
		statusCk: check('watch_status_ck', sql`${t.status} in ('active','paused')`),
		provIdx: index('watch_provider_idx').on(t.providerId),
		statusIdx: index('watch_status_idx').on(t.status)
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
		kindCk: check('rem_kind_ck', sql`${t.kind} in ('flight_checkin','document_expiry')`),
		refCk: check('rem_ref_ck', sql`${t.refType} in ('segment','document')`),
		statCk: check('rem_stat_ck', sql`${t.status} in ('pending','sending','sent')`),
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
