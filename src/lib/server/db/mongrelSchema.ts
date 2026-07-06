import {
	table,
	int,
	text,
	real,
	bool,
	json,
	timestamp,
	date,
	index,
	unique,
	foreignKey,
	check,
	Schema,
	nowDefault,
	staticDefault,
	sequenceDefault
} from '@visorcraft/mongreldb-kit';
import { SEGMENT_TYPES, type SegmentType } from '$lib/segmentLabels';

const ROLES = ['admin', 'user'] as const;
const VISIBILITIES = ['private', 'groups', 'public'] as const;
const TRIP_STATUSES = ['planning', 'booked', 'active', 'completed'] as const;
const SHARE_PERMISSIONS = ['read', 'edit'] as const;
const CARD_NETWORKS = ['visa', 'mc', 'amex', 'disc', 'other'] as const;
const BENEFIT_TYPES = ['trip_delay', 'baggage_delay', 'trip_cancellation', 'other'] as const;
const REMINDER_KINDS = ['flight_checkin', 'document_expiry', 'custom'] as const;
const REMINDER_REF_TYPES = ['segment', 'document', 'trip'] as const;
const REMINDER_STATUSES = ['pending', 'sending', 'sent'] as const;
const EXPENSE_CATEGORIES = ['lodging', 'transport', 'food', 'activities', 'other'] as const;
const WATCH_STATUSES = ['active', 'paused'] as const;
const MAPS_TILE_PROVIDERS = [
	'openstreetmap',
	'carto',
	'maptiler',
	'stadia',
	'thunderforest',
	'jawg',
	'protomaps',
	'custom'
] as const;
const SEGMENT_STATUSES = ['planned', 'checked_in', 'boarded', 'arrived', 'completed'] as const;
const SEGMENT_PAYMENT_STATUSES = ['quoted', 'deposit_paid', 'fully_paid', 'refunded'] as const;
const TRAVEL_DOCUMENT_TYPES = ['passport', 'drivers_license', 'global_entry', 'visa'] as const;
const COMPANION_CATEGORIES = ['adult', 'child', 'other'] as const;
const SEAT_PREFERENCES = ['aisle', 'window', 'middle', 'none'] as const;
const BED_PREFERENCES = ['king', 'queen', 'twin', 'two_doubles', 'other'] as const;
const SEGMENT_ATTENDEE_STATUSES = ['going', 'maybe', 'not_going'] as const;
const ENTRY_REQUIREMENT_TYPES = ['visa', 'vaccination', 'other'] as const;
const ENTRY_REQUIREMENT_STATUSES = ['needed', 'in_progress', 'complete', 'not_needed'] as const;
const SMTP_SECURITY_MODES = ['none', 'starttls', 'ssl/tls'] as const;
const WEBAUTHN_CHALLENGE_PURPOSES = ['register', 'auth'] as const;
const OAUTH_CODE_CHALLENGE_METHODS = ['S256'] as const;

export {
	ROLES,
	VISIBILITIES,
	TRIP_STATUSES,
	SHARE_PERMISSIONS,
	CARD_NETWORKS,
	BENEFIT_TYPES,
	REMINDER_KINDS,
	REMINDER_REF_TYPES,
	REMINDER_STATUSES,
	EXPENSE_CATEGORIES,
	WATCH_STATUSES,
	MAPS_TILE_PROVIDERS,
	SEGMENT_TYPES,
	SEGMENT_STATUSES,
	SEGMENT_PAYMENT_STATUSES,
	TRAVEL_DOCUMENT_TYPES,
	COMPANION_CATEGORIES,
	SEAT_PREFERENCES,
	BED_PREFERENCES,
	SEGMENT_ATTENDEE_STATUSES,
	ENTRY_REQUIREMENT_TYPES,
	ENTRY_REQUIREMENT_STATUSES
};

export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];
export type SegmentAttendeeStatus = (typeof SEGMENT_ATTENDEE_STATUSES)[number];
export type TravelDocumentType = (typeof TRAVEL_DOCUMENT_TYPES)[number];
export type CompanionCategory = (typeof COMPANION_CATEGORIES)[number];
export type { SegmentType };

export const schedulerRuns = table('scheduler_runs', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('scheduler_runs_id_seq') }),
		timestamp('started_at'),
		timestamp('finished_at', { nullable: true }),
		bool('success', { default: staticDefault(false) }),
		text('error_message', { nullable: true })
	],
	primaryKey: 'id',
	indexes: [index(['started_at'], { name: 'scheduler_runs_started_idx' })]
});

export const users = table('users', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('users_id_seq') }),
		text('email'),
		text('password_hash'),
		text('display_name'),
		text('role', { enumValues: [...ROLES], default: staticDefault('user') }),
		bool('disabled', { default: staticDefault(false) }),
		bool('must_reset_password', { default: staticDefault(false) }),
		text('timezone', { default: staticDefault('UTC') }),
		int('flight_checkin_lead_hours', { default: staticDefault(24n) }),
		int('document_expiry_lead_days', { default: staticDefault(90n) }),
		bool('email_notifications', { default: staticDefault(true) }),
		bool('webhook_notifications', { default: staticDefault(true) }),
		bool('auto_mark_visited', { default: staticDefault(false) }),
		text('theme_id', { default: staticDefault('system') }),
		text('default_currency', { default: staticDefault('USD') }),
		text('calendar_token', { nullable: true }),
		timestamp('calendar_token_expires_at', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [
		unique(['email'], { name: 'users_email_uq' }),
		unique(['calendar_token'], { name: 'users_calendar_token_uq' })
	],
	checks: [
		check('users_flight_lead_ck', (r) => (r.flight_checkin_lead_hours as number) >= 0),
		check('users_doc_lead_ck', (r) => (r.document_expiry_lead_days as number) >= 0)
	]
});

export const sessions = table('sessions', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('sessions_id_seq') }),
		text('token_hash'),
		int('user_id'),
		timestamp('expires_at'),
		text('last_ip', { nullable: true }),
		text('user_agent', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['token_hash'], { name: 'sessions_token_hash_uq' })],
	indexes: [
		index(['user_id'], { name: 'sessions_user_idx' }),
		index(['expires_at'], { name: 'sessions_expires_idx' })
	],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_sessions_user_id_users', onDelete: 'cascade' })
	]
});

export const passwordResetTokens = table('password_reset_tokens', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('password_reset_tokens_id_seq') }),
		text('token_hash'),
		int('user_id'),
		timestamp('expires_at'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['token_hash'], { name: 'password_reset_tokens_token_hash_uq' })],
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_password_reset_tokens_user_id_users', onDelete: 'cascade' }
		)
	]
});

export const settings = table('settings', {
	columns: [
		int('id', { primaryKey: true }),
		text('instance_name', { default: staticDefault('Roamarr') }),
		bool('setup_complete', { default: staticDefault(false) }),
		bool('allow_registration', { default: staticDefault(false) }),
		text('default_timezone', { default: staticDefault('UTC') }),
		text('default_currency', { default: staticDefault('USD') }),
		int('default_flight_checkin_lead_hours', { default: staticDefault(24n) }),
		int('default_document_expiry_lead_days', { default: staticDefault(90n) }),
		text('smtp_host', { nullable: true }),
		int('smtp_port', { nullable: true }),
		text('smtp_security', { enumValues: [...SMTP_SECURITY_MODES], nullable: true }),
		text('smtp_user', { nullable: true }),
		text('smtp_pass', { nullable: true }),
		text('smtp_from', { nullable: true }),
		text('webhook_url', { nullable: true }),
		bool('maps_enabled', { default: staticDefault(false) }),
		timestamp('maps_geonames_imported_at', { nullable: true }),
		text('maps_tile_provider', {
			enumValues: [...MAPS_TILE_PROVIDERS],
			default: staticDefault('openstreetmap')
		}),
		text('maps_tile_url', { nullable: true }),
		text('maps_tile_attribution', { nullable: true }),
		text('maps_tile_api_key', { nullable: true }),
		json('oauth_client_allow_list', { nullable: true })
	],
	primaryKey: 'id'
});

export const userTwoFactor = table('user_two_factor', {
	columns: [
		int('user_id', { primaryKey: true }),
		text('secret_encrypted'),
		bool('enabled', { default: staticDefault(false) }),
		timestamp('enabled_at', { nullable: true }),
		int('backup_codes_count', { default: staticDefault(0n) })
	],
	primaryKey: 'user_id',
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_user_two_factor_user_id_users', onDelete: 'cascade' }
		)
	]
});

export const twoFactorBackupCodes = table('two_factor_backup_codes', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('two_factor_backup_codes_id_seq') }),
		int('user_id'),
		text('code_hash'),
		timestamp('used_at', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['user_id', 'code_hash'], { name: 'two_factor_backup_codes_user_hash_uq' })],
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_two_factor_backup_codes_user_id_users', onDelete: 'cascade' }
		)
	]
});

export const passkeys = table('passkeys', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('passkeys_id_seq') }),
		int('user_id'),
		text('credential_id'),
		text('public_key'),
		int('counter', { default: staticDefault(0n) }),
		text('transports', { nullable: true }),
		text('device_type', { nullable: true }),
		text('name', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('last_used_at', { nullable: true })
	],
	primaryKey: 'id',
	unique: [unique(['credential_id'], { name: 'passkeys_credential_id_uq' })],
	indexes: [index(['user_id'], { name: 'passkeys_user_idx' })],
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_passkeys_user_id_users', onDelete: 'cascade' }
		)
	]
});

export const userSmtpOverrides = table('user_smtp_overrides', {
	columns: [
		int('user_id', { primaryKey: true }),
		bool('enabled'),
		text('host', { nullable: true }),
		int('port', { nullable: true }),
		text('security', { enumValues: [...SMTP_SECURITY_MODES], nullable: true }),
		text('username', { nullable: true }),
		text('password', { nullable: true }),
		text('from_address', { nullable: true }),
		timestamp('updated_at', { default: nowDefault() })
	],
	primaryKey: 'user_id',
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_user_smtp_overrides_user_id_users', onDelete: 'cascade' }
		)
	]
});

export const webauthnChallenges = table('webauthn_challenges', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('webauthn_challenges_id_seq') }),
		text('challenge_hash'),
		int('user_id', { nullable: true }),
		text('purpose', { enumValues: [...WEBAUTHN_CHALLENGE_PURPOSES] }),
		timestamp('expires_at')
	],
	primaryKey: 'id',
	unique: [unique(['challenge_hash'], { name: 'webauthn_challenges_hash_uq' })],
	indexes: [index(['expires_at'], { name: 'webauthn_challenges_expires_idx' })]
});

export const oauthClients = table('oauth_clients', {
	columns: [
		text('client_id', { primaryKey: true }),
		text('client_name'),
		text('client_secret_hash', { nullable: true }),
		text('redirect_uris'),
		text('scopes'),
		timestamp('created_at', { default: nowDefault() }),
		int('created_by_user_id', { nullable: true })
	],
	primaryKey: 'client_id',
	foreignKeys: [
		foreignKey(
			['created_by_user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_oauth_clients_created_by_user_id_users', onDelete: 'cascade' }
		)
	]
});

export const oauthCodes = table('oauth_codes', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('oauth_codes_id_seq') }),
		text('code_hash'),
		text('client_id'),
		int('user_id'),
		text('scopes'),
		text('code_challenge'),
		text('code_challenge_method', { enumValues: [...OAUTH_CODE_CHALLENGE_METHODS] }),
		text('redirect_uri'),
		timestamp('expires_at'),
		timestamp('used_at', { nullable: true })
	],
	primaryKey: 'id',
	unique: [unique(['code_hash'], { name: 'oauth_codes_hash_uq' })],
	indexes: [index(['expires_at'], { name: 'oauth_codes_expires_idx' })]
});

export const oauthTokens = table('oauth_tokens', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('oauth_tokens_id_seq') }),
		text('access_token_hash'),
		text('refresh_token_hash', { nullable: true }),
		text('client_id'),
		int('user_id'),
		text('scopes'),
		timestamp('expires_at'),
		timestamp('refresh_expires_at', { nullable: true }),
		timestamp('revoked_at', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('last_used_at', { nullable: true })
	],
	primaryKey: 'id',
	unique: [
		unique(['access_token_hash'], { name: 'oauth_tokens_access_hash_uq' }),
		unique(['refresh_token_hash'], { name: 'oauth_tokens_refresh_hash_uq' })
	],
	indexes: [
		index(['refresh_token_hash'], { name: 'oauth_tokens_refresh_hash_idx' }),
		index(['user_id'], { name: 'oauth_tokens_user_idx' })
	]
});

export const weatherCache = table('weather_cache', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('weather_cache_id_seq') }),
		text('location_key'),
		date('for_date'),
		timestamp('fetched_at'),
		json('payload_json')
	],
	primaryKey: 'id',
	unique: [unique(['location_key', 'for_date'], { name: 'weather_cache_key_date_uq' })],
	indexes: [index(['fetched_at'], { name: 'weather_cache_fetched_idx' })]
});

export const geonamesCities = table('geonames_cities', {
	columns: [
		int('geoname_id', { primaryKey: true }),
		text('name'),
		text('ascii_name'),
		text('country_code'),
		real('lat'),
		real('lng'),
		int('population', { nullable: true }),
		text('timezone', { nullable: true })
	],
	primaryKey: 'geoname_id',
	indexes: [
		index(['country_code', 'name'], { name: 'geonames_country_name_idx' }),
		index(['country_code', 'ascii_name'], { name: 'geonames_country_ascii_idx' })
	]
});

export const trips = table('trips', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trips_id_seq') }),
		int('owner_id'),
		text('name'),
		text('destination', { nullable: true }),
		text('destination_country_code', { nullable: true }),
		text('destination_city_name', { nullable: true }),
		real('destination_city_lat', { nullable: true }),
		real('destination_city_lng', { nullable: true }),
		date('start_date', { nullable: true }),
		date('end_date', { nullable: true }),
		text('notes', { nullable: true }),
		json('tags', { default: staticDefault('[]') }),
		bool('archived', { default: staticDefault(false) }),
		bool('favorite', { default: staticDefault(false) }),
		text('default_visibility', {
			enumValues: [...VISIBILITIES],
			default: staticDefault('private')
		}),
		text('public_token', { nullable: true }),
		timestamp('public_token_expires_at', { nullable: true }),
		bool('public_show_details', { default: staticDefault(false) }),
		text('calendar_token', { nullable: true }),
		timestamp('calendar_token_expires_at', { nullable: true }),
		text('base_currency', { default: staticDefault('USD') }),
		text('status', { enumValues: [...TRIP_STATUSES], default: staticDefault('booked') }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('updated_at', { generated: 'now' })
	],
	primaryKey: 'id',
	unique: [],
	indexes: [
		index(['owner_id'], { name: 'trips_owner_idx' }),
		index(['start_date'], { name: 'trips_start_idx' })
	],
	foreignKeys: [
		foreignKey(['owner_id'], { table: 'users', columns: ['id'] }, { name: 'fk_trips_owner_id_users', onDelete: 'cascade' })
	]
});

export const tripComments = table('trip_comments', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_comments_id_seq') }),
		int('trip_id'),
		int('user_id'),
		text('body'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'trip_comments_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_comments_trip_id_trips', onDelete: 'cascade' }),
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_trip_comments_user_id_users', onDelete: 'cascade' })
	]
});

export const segments = table('segments', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('segments_id_seq') }),
		int('trip_id'),
		text('type', { enumValues: [...SEGMENT_TYPES] }),
		text('title'),
		timestamp('start_at'),
		text('start_tz', { default: staticDefault('UTC') }),
		timestamp('end_at', { nullable: true }),
		text('end_tz', { nullable: true }),
		text('status', { enumValues: [...SEGMENT_STATUSES], default: staticDefault('planned') }),
		text('location', { nullable: true }),
		text('country_code', { nullable: true }),
		text('city_name', { nullable: true }),
		real('city_lat', { nullable: true }),
		real('city_lng', { nullable: true }),
		text('venue', { nullable: true }),
		text('confirmation_number', { nullable: true }),
		json('details_json', { nullable: true }),
		text('meeting_point', { nullable: true }),
		timestamp('meeting_at', { nullable: true }),
		text('payment_status', {
			enumValues: [...SEGMENT_PAYMENT_STATUSES],
			default: staticDefault('quoted')
		}),
		date('payment_due_date', { nullable: true }),
		int('card_id', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('updated_at', { generated: 'now' })
	],
	primaryKey: 'id',
	indexes: [
		index(['trip_id'], { name: 'segments_trip_idx' }),
		index(['start_at'], { name: 'segments_start_idx' })
	],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_segments_trip_id_trips', onDelete: 'cascade' }),
		foreignKey(['card_id'], { table: 'cards', columns: ['id'] }, { name: 'fk_segments_card_id_cards', onDelete: 'set null' })
	]
});

export const travelDocuments = table('travel_documents', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('travel_documents_id_seq') }),
		int('user_id'),
		int('companion_id', { nullable: true }),
		text('type', { enumValues: [...TRAVEL_DOCUMENT_TYPES] }),
		text('number', { nullable: true }),
		text('issuing_authority', { nullable: true }),
		date('expires_on', { nullable: true }),
		text('notes', { nullable: true })
	],
	primaryKey: 'id',
	indexes: [
		index(['user_id', 'expires_on'], { name: 'docs_user_exp_idx' }),
		index(['companion_id'], { name: 'docs_companion_idx' })
	],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_travel_documents_user_id_users', onDelete: 'cascade' }),
		foreignKey(
			['companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_travel_documents_companion_id_trip_companions', onDelete: 'cascade' }
		)
	]
});

export const loyaltyPrograms = table('loyalty_programs', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('loyalty_programs_id_seq') }),
		int('user_id'),
		text('program_name'),
		text('membership_number', { nullable: true }),
		int('balance', { nullable: true }),
		text('notes', { nullable: true })
	],
	primaryKey: 'id',
	indexes: [index(['user_id'], { name: 'loyalty_user_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_loyalty_programs_user_id_users', onDelete: 'cascade' })
	]
});

export const groups = table('groups', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('groups_id_seq') }),
		int('owner_id'),
		text('name'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['owner_id'], { name: 'groups_owner_idx' })],
	foreignKeys: [
		foreignKey(['owner_id'], { table: 'users', columns: ['id'] }, { name: 'fk_groups_owner_id_users', onDelete: 'cascade' })
	]
});

export const groupMembers = table('group_members', {
	columns: [
		int('group_id'),
		int('user_id')
	],
	primaryKey: ['group_id', 'user_id'],
	indexes: [index(['user_id'], { name: 'gm_user_idx' })],
	foreignKeys: [
		foreignKey(['group_id'], { table: 'groups', columns: ['id'] }, { name: 'fk_group_members_group_id_groups', onDelete: 'cascade' }),
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_group_members_user_id_users', onDelete: 'cascade' })
	]
});

export const tripShares = table('trip_shares', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_shares_id_seq') }),
		int('trip_id'),
		int('shared_with_user_id', { nullable: true }),
		int('shared_with_group_id', { nullable: true }),
		text('permission', { enumValues: [...SHARE_PERMISSIONS], default: staticDefault('read') }),
		bool('show_details', { default: staticDefault(false) }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [
		unique(['trip_id', 'shared_with_user_id'], { name: 'shares_trip_user_uq' }),
		unique(['trip_id', 'shared_with_group_id'], { name: 'shares_trip_group_uq' })
	],
	indexes: [
		index(['shared_with_user_id'], { name: 'shares_user_idx' }),
		index(['shared_with_group_id'], { name: 'shares_group_idx' })
	],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_shares_trip_id_trips', onDelete: 'cascade' }),
		foreignKey(
			['shared_with_user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_trip_shares_shared_with_user_id_users', onDelete: 'cascade' }
		),
		foreignKey(
			['shared_with_group_id'],
			{ table: 'groups', columns: ['id'] },
			{ name: 'fk_trip_shares_shared_with_group_id_groups', onDelete: 'cascade' }
		)
	],
	checks: []
});

export const cards = table('cards', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('cards_id_seq') }),
		int('user_id'),
		text('nickname'),
		text('network', { enumValues: [...CARD_NETWORKS] }),
		text('last4', { nullable: true }),
		text('notes', { nullable: true })
	],
	primaryKey: 'id',
	indexes: [index(['user_id'], { name: 'cards_user_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_cards_user_id_users', onDelete: 'cascade' })
	]
});

export const cardBenefits = table('card_benefits', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('card_benefits_id_seq') }),
		int('card_id'),
		text('benefit_type', { enumValues: [...BENEFIT_TYPES] }),
		int('coverage_amount', { nullable: true }),
		text('currency', { default: staticDefault('USD') }),
		text('notes', { nullable: true })
	],
	primaryKey: 'id',
	foreignKeys: [
		foreignKey(['card_id'], { table: 'cards', columns: ['id'] }, { name: 'fk_card_benefits_card_id_cards', onDelete: 'cascade' })
	]
});

export const benefitTemplates = table('benefit_templates', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('benefit_templates_id_seq') }),
		text('benefit_type', { enumValues: [...BENEFIT_TYPES] }),
		text('name'),
		int('coverage_amount', { nullable: true }),
		text('currency', { default: staticDefault('USD') }),
		text('description', { nullable: true })
	],
	primaryKey: 'id'
});

export const insurancePolicies = table('insurance_policies', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('insurance_policies_id_seq') }),
		int('user_id'),
		text('provider'),
		text('policy_number', { nullable: true }),
		text('coverage_summary', { nullable: true }),
		int('coverage_amount', { nullable: true }),
		text('currency', { default: staticDefault('USD') }),
		date('start_date', { nullable: true }),
		date('end_date', { nullable: true }),
		int('trip_id', { nullable: true }),
		text('notes', { nullable: true })
	],
	primaryKey: 'id',
	indexes: [
		index(['user_id'], { name: 'ins_user_idx' }),
		index(['trip_id'], { name: 'ins_trip_idx' })
	],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_insurance_policies_user_id_users', onDelete: 'cascade' }),
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_insurance_policies_trip_id_trips', onDelete: 'set null' })
	]
});

export const fareProviders = table('fare_providers', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('fare_providers_id_seq') }),
		int('user_id'),
		text('provider_key'),
		text('label', { default: staticDefault('') }),
		text('api_key', { nullable: true }),
		bool('enabled', { default: staticDefault(true) })
	],
	primaryKey: 'id',
	indexes: [index(['user_id'], { name: 'fare_providers_user_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_fare_providers_user_id_users', onDelete: 'cascade' })
	]
});

export const fareWatches = table('fare_watches', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('fare_watches_id_seq') }),
		int('trip_id'),
		int('segment_id', { nullable: true }),
		int('provider_id'),
		text('status', { enumValues: [...WATCH_STATUSES], default: staticDefault('active') }),
		timestamp('last_checked_at', { nullable: true }),
		json('last_result_json', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [
		index(['provider_id'], { name: 'watch_provider_idx' }),
		index(['status'], { name: 'watch_status_idx' }),
		index(['trip_id'], { name: 'watch_trip_idx' }),
		index(['segment_id'], { name: 'watch_segment_idx' })
	],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_fare_watches_trip_id_trips', onDelete: 'cascade' }),
		foreignKey(['segment_id'], { table: 'segments', columns: ['id'] }, { name: 'fk_fare_watches_segment_id_segments', onDelete: 'cascade' }),
		foreignKey(
			['provider_id'],
			{ table: 'fare_providers', columns: ['id'] },
			{ name: 'fk_fare_watches_provider_id_fare_providers', onDelete: 'cascade' }
		)
	]
});

export const reminders = table('reminders', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('reminders_id_seq') }),
		int('user_id'),
		text('kind', { enumValues: [...REMINDER_KINDS] }),
		text('ref_type', { enumValues: [...REMINDER_REF_TYPES] }),
		int('ref_id'),
		timestamp('fire_at'),
		text('status', { enumValues: [...REMINDER_STATUSES], default: staticDefault('pending') }),
		int('attempts', { default: staticDefault(0n) }),
		timestamp('sent_at', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['kind', 'ref_type', 'ref_id'], { name: 'rem_source_uq' })],
	indexes: [index(['status', 'fire_at'], { name: 'rem_due_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_reminders_user_id_users', onDelete: 'cascade' })
	]
});

export const notifications = table('notifications', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('notifications_id_seq') }),
		int('user_id'),
		text('title'),
		text('body'),
		text('link', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('read_at', { nullable: true })
	],
	primaryKey: 'id',
	indexes: [index(['user_id', 'read_at'], { name: 'notif_user_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_notifications_user_id_users', onDelete: 'cascade' })
	]
});

export const auditLogs = table('audit_logs', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('audit_logs_id_seq') }),
		int('user_id'),
		text('action'),
		text('entity_type'),
		int('entity_id'),
		json('meta_json', { default: staticDefault('{}') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [
		index(['user_id'], { name: 'audit_user_idx' }),
		index(['entity_type', 'entity_id'], { name: 'audit_entity_idx' })
	],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_audit_logs_user_id_users', onDelete: 'cascade' })
	]
});

export const tripCompanions = table('trip_companions', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_companions_id_seq') }),
		int('trip_id'),
		text('name'),
		text('category', { enumValues: [...COMPANION_CATEGORIES], default: staticDefault('adult') }),
		text('dietary', { nullable: true }),
		text('allergies', { nullable: true }),
		text('medical_notes', { nullable: true }),
		bool('needs_car_seat', { default: staticDefault(false) }),
		bool('needs_stroller', { default: staticDefault(false) }),
		bool('needs_crib', { default: staticDefault(false) }),
		bool('needs_kids_meal', { default: staticDefault(false) }),
		text('child_ticket_discount', { nullable: true }),
		text('seat_preference', { nullable: true }),
		text('bed_preference', { nullable: true }),
		text('accessibility_needs', { nullable: true }),
		text('room_notes', { nullable: true }),
		text('notes', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'companions_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_companions_trip_id_trips', onDelete: 'cascade' })
	]
});

export const tripChecklists = table('trip_checklists', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_checklists_id_seq') }),
		int('trip_id'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['trip_id'], { name: 'checklist_trip_uq' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_checklists_trip_id_trips', onDelete: 'cascade' })
	]
});

export const tripChecklistItems = table('trip_checklist_items', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_checklist_items_id_seq') }),
		int('checklist_id'),
		text('text'),
		bool('packed', { default: staticDefault(false) }),
		int('assigned_to_companion_id', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['checklist_id'], { name: 'checklist_items_checklist_idx' })],
	foreignKeys: [
		foreignKey(
			['checklist_id'],
			{ table: 'trip_checklists', columns: ['id'] },
			{ name: 'fk_trip_checklist_items_checklist_id_trip_checklists', onDelete: 'cascade' }
		),
		foreignKey(
			['assigned_to_companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_trip_checklist_items_assigned_to_companion_id_trip_companions', onDelete: 'set null' }
		)
	]
});

export const tripExpenses = table('trip_expenses', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_expenses_id_seq') }),
		int('trip_id'),
		text('description'),
		int('amount'),
		text('currency', { default: staticDefault('USD') }),
		text('category', {
				enumValues: [...EXPENSE_CATEGORIES],
				default: staticDefault('other'),
				nullable: true
			}),
		int('exchange_rate', { default: staticDefault(10000n) }),
		int('base_amount', { default: staticDefault(0n) }),
		int('paid_by_companion_id', { nullable: true }),
		json('split_among', { default: staticDefault('[]') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'expenses_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_expenses_trip_id_trips', onDelete: 'cascade' }),
		foreignKey(
			['paid_by_companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_trip_expenses_paid_by_companion_id_trip_companions', onDelete: 'set null' }
		)
	]
});

export const segmentAttendees = table('segment_attendees', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('segment_attendees_id_seq') }),
		int('segment_id'),
		int('companion_id'),
		text('status', { enumValues: [...SEGMENT_ATTENDEE_STATUSES], default: staticDefault('going') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['segment_id', 'companion_id'], { name: 'attendee_segment_companion_uq' })],
	indexes: [index(['segment_id'], { name: 'attendees_segment_idx' })],
	foreignKeys: [
		foreignKey(
			['segment_id'],
			{ table: 'segments', columns: ['id'] },
			{ name: 'fk_segment_attendees_segment_id_segments', onDelete: 'cascade' }
		),
		foreignKey(
			['companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_segment_attendees_companion_id_trip_companions', onDelete: 'cascade' }
		)
	]
});

export const emergencyContacts = table('emergency_contacts', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('emergency_contacts_id_seq') }),
		int('user_id'),
		text('name'),
		text('relationship', { nullable: true }),
		text('phone', { nullable: true }),
		text('email', { nullable: true }),
		bool('is_primary', { default: staticDefault(false) }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['user_id'], { name: 'emergency_contacts_user_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_emergency_contacts_user_id_users', onDelete: 'cascade' })
	]
});

export const tripJournalEntries = table('trip_journal_entries', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_journal_entries_id_seq') }),
		int('trip_id'),
		date('entry_date'),
		text('title'),
		text('body'),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('updated_at', { generated: 'now' })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'journal_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_journal_entries_trip_id_trips', onDelete: 'cascade' })
	]
});

export const tripDocumentLinks = table('trip_document_links', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_document_links_id_seq') }),
		int('trip_id'),
		text('label'),
		text('url'),
		text('notes', { nullable: true }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'doc_links_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_document_links_trip_id_trips', onDelete: 'cascade' })
	]
});

export const packingTemplates = table('packing_templates', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('packing_templates_id_seq') }),
		int('user_id'),
		text('name'),
		bool('is_default', { default: staticDefault(false) }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['user_id'], { name: 'packing_templates_user_idx' })],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_packing_templates_user_id_users', onDelete: 'cascade' })
	]
});

export const packingTemplateItems = table('packing_template_items', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('packing_template_items_id_seq') }),
		int('template_id'),
		text('label'),
		text('category', { default: staticDefault('general') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['template_id'], { name: 'packing_template_items_template_idx' })],
	foreignKeys: [
		foreignKey(
			['template_id'],
			{ table: 'packing_templates', columns: ['id'] },
			{ name: 'fk_packing_template_items_template_id_packing_templates', onDelete: 'cascade' }
		)
	]
});

export const tripPolls = table('trip_polls', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_polls_id_seq') }),
		int('trip_id'),
		text('question'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'trip_polls_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_polls_trip_id_trips', onDelete: 'cascade' })
	]
});

export const tripPollOptions = table('trip_poll_options', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_poll_options_id_seq') }),
		int('poll_id'),
		text('label'),
		int('sort_order', { default: staticDefault(0n) }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['poll_id'], { name: 'trip_poll_options_poll_idx' })],
	foreignKeys: [
		foreignKey(
			['poll_id'],
			{ table: 'trip_polls', columns: ['id'] },
			{ name: 'fk_trip_poll_options_poll_id_trip_polls', onDelete: 'cascade' }
		)
	]
});

export const tripPollVotes = table('trip_poll_votes', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_poll_votes_id_seq') }),
		int('poll_id'),
		int('option_id'),
		int('companion_id'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['poll_id', 'companion_id'], { name: 'trip_poll_votes_poll_companion_uq' })],
	indexes: [index(['poll_id'], { name: 'trip_poll_votes_poll_idx' })],
	foreignKeys: [
		foreignKey(['poll_id'], { table: 'trip_polls', columns: ['id'] }, { name: 'fk_trip_poll_votes_poll_id_trip_polls', onDelete: 'cascade' }),
		foreignKey(
			['option_id'],
			{ table: 'trip_poll_options', columns: ['id'] },
			{ name: 'fk_trip_poll_votes_option_id_trip_poll_options', onDelete: 'cascade' }
		),
		foreignKey(
			['companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_trip_poll_votes_companion_id_trip_companions', onDelete: 'cascade' }
		)
	]
});

export const tripBudgetCategories = table('trip_budget_categories', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_budget_categories_id_seq') }),
		int('trip_id'),
		text('category'),
		int('amount'),
		text('currency', { default: staticDefault('USD') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['trip_id', 'category'], { name: 'trip_budget_categories_trip_category_uq' })],
	indexes: [index(['trip_id'], { name: 'trip_budget_categories_trip_idx' })],
	foreignKeys: [
		foreignKey(
			['trip_id'],
			{ table: 'trips', columns: ['id'] },
			{ name: 'fk_trip_budget_categories_trip_id_trips', onDelete: 'cascade' }
		)
	]
});

export const attachments = table('attachments', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('attachments_id_seq') }),
		int('owner_id'),
		text('storage_key'),
		text('filename'),
		text('content_type'),
		int('size_bytes', { default: staticDefault(0n) }),
		json('context'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['storage_key'], { name: 'attachments_storage_key_uq' })],
	indexes: [index(['owner_id'], { name: 'attachments_owner_idx' })],
	foreignKeys: [
		foreignKey(
			['owner_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_attachments_owner_id_users', onDelete: 'cascade' }
		)
	]
});

export const tripExpenseAttachments = table('trip_expense_attachments', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_expense_attachments_id_seq') }),
		int('expense_id'),
		int('attachment_id'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['attachment_id'], { name: 'trip_expense_attachments_attachment_id_uq' })],
	indexes: [index(['expense_id'], { name: 'expense_attachments_expense_idx' })],
	foreignKeys: [
		foreignKey(
			['expense_id'],
			{ table: 'trip_expenses', columns: ['id'] },
			{ name: 'fk_trip_expense_attachments_expense_id_trip_expenses', onDelete: 'cascade' }
		),
		foreignKey(
			['attachment_id'],
			{ table: 'attachments', columns: ['id'] },
			{ name: 'fk_trip_expense_attachments_attachment_id_attachments', onDelete: 'cascade' }
		)
	]
});

export const tripTemplates = table('trip_templates', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_templates_id_seq') }),
		int('user_id'),
		text('name'),
		int('source_trip_id', { nullable: true }),
		json('snapshot_json'),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [
		index(['user_id'], { name: 'trip_templates_user_idx' }),
		index(['source_trip_id'], { name: 'trip_templates_source_idx' })
	],
	foreignKeys: [
		foreignKey(['user_id'], { table: 'users', columns: ['id'] }, { name: 'fk_trip_templates_user_id_users', onDelete: 'cascade' }),
		foreignKey(
			['source_trip_id'],
			{ table: 'trips', columns: ['id'] },
			{ name: 'fk_trip_templates_source_trip_id_trips', onDelete: 'set null' }
		)
	]
});

export const tripHomeTasks = table('trip_home_tasks', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_home_tasks_id_seq') }),
		int('trip_id'),
		text('text'),
		date('due_date', { nullable: true }),
		bool('done', { default: staticDefault(false) }),
		int('sort_order', { default: staticDefault(0n) }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'home_tasks_trip_idx' })],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_home_tasks_trip_id_trips', onDelete: 'cascade' })
	]
});

export const tripMedications = table('trip_medications', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_medications_id_seq') }),
		int('trip_id'),
		int('companion_id', { nullable: true }),
		text('name'),
		text('dosage', { nullable: true }),
		text('schedule', { nullable: true }),
		timestamp('starts_at', { nullable: true }),
		timestamp('ends_at', { nullable: true }),
		text('notes', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('updated_at', { generated: 'now' })
	],
	primaryKey: 'id',
	indexes: [
		index(['trip_id'], { name: 'medications_trip_idx' }),
		index(['companion_id'], { name: 'medications_companion_idx' })
	],
	foreignKeys: [
		foreignKey(['trip_id'], { table: 'trips', columns: ['id'] }, { name: 'fk_trip_medications_trip_id_trips', onDelete: 'cascade' }),
		foreignKey(
			['companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_trip_medications_companion_id_trip_companions', onDelete: 'set null' }
		)
	]
});

export const tripEntryRequirements = table('trip_entry_requirements', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_entry_requirements_id_seq') }),
		int('trip_id'),
		text('country'),
		text('requirement_type', { enumValues: [...ENTRY_REQUIREMENT_TYPES] }),
		text('status', { enumValues: [...ENTRY_REQUIREMENT_STATUSES], default: staticDefault('needed') }),
		date('due_date', { nullable: true }),
		text('notes', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('updated_at', { generated: 'now' })
	],
	primaryKey: 'id',
	indexes: [index(['trip_id'], { name: 'entry_req_trip_idx' })],
	foreignKeys: [
		foreignKey(
			['trip_id'],
			{ table: 'trips', columns: ['id'] },
			{ name: 'fk_trip_entry_requirements_trip_id_trips', onDelete: 'cascade' }
		)
	]
});

export const tripImportantItems = table('trip_important_items', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('trip_important_items_id_seq') }),
		int('trip_id'),
		int('companion_id', { nullable: true }),
		text('name'),
		text('serial_number', { nullable: true }),
		text('tracker_id', { nullable: true }),
		text('notes', { nullable: true }),
		timestamp('created_at', { default: nowDefault() }),
		timestamp('updated_at', { generated: 'now' })
	],
	primaryKey: 'id',
	indexes: [
		index(['trip_id'], { name: 'important_items_trip_idx' }),
		index(['companion_id'], { name: 'important_items_companion_idx' })
	],
	foreignKeys: [
		foreignKey(
			['trip_id'],
			{ table: 'trips', columns: ['id'] },
			{ name: 'fk_trip_important_items_trip_id_trips', onDelete: 'cascade' }
		),
		foreignKey(
			['companion_id'],
			{ table: 'trip_companions', columns: ['id'] },
			{ name: 'fk_trip_important_items_companion_id_trip_companions', onDelete: 'set null' }
		)
	]
});

const PLACE_SOURCES = ['manual', 'trip', 'ai'] as const;

export const visitedCountries = table('visited_countries', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('visited_countries_id_seq') }),
		int('user_id'),
		text('country_code'),
		date('visited_on', { nullable: true }),
		text('source', { default: staticDefault('manual') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['user_id', 'country_code'], { name: 'visited_countries_user_country_uq' })],
	indexes: [index(['user_id'], { name: 'visited_countries_user_idx' })],
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_visited_countries_user_id_users', onDelete: 'cascade' }
		)
	],
	checks: [
		check('visited_countries_source_ck', (r) =>
			PLACE_SOURCES.includes(r.source as (typeof PLACE_SOURCES)[number])
				? true
				: 'source must be manual, trip, or ai'
		)
	]
});

export const visitedUsStates = table('visited_us_states', {
	columns: [
		int('id', { primaryKey: true, default: sequenceDefault('visited_us_states_id_seq') }),
		int('user_id'),
		text('state_code'),
		date('visited_on', { nullable: true }),
		text('source', { default: staticDefault('manual') }),
		timestamp('created_at', { default: nowDefault() })
	],
	primaryKey: 'id',
	unique: [unique(['user_id', 'state_code'], { name: 'visited_us_states_user_state_uq' })],
	indexes: [index(['user_id'], { name: 'visited_us_states_user_idx' })],
	foreignKeys: [
		foreignKey(
			['user_id'],
			{ table: 'users', columns: ['id'] },
			{ name: 'fk_visited_us_states_user_id_users', onDelete: 'cascade' }
		)
	],
	checks: [
		check('visited_us_states_source_ck', (r) =>
			PLACE_SOURCES.includes(r.source as (typeof PLACE_SOURCES)[number])
				? true
				: 'source must be manual, trip, or ai'
		)
	]
});

export const schema = new Schema([
	schedulerRuns,
	users,
	sessions,
	passwordResetTokens,
	settings,
	geonamesCities,
	trips,
	tripComments,
	segments,
	travelDocuments,
	loyaltyPrograms,
	groups,
	groupMembers,
	tripShares,
	cards,
	cardBenefits,
	benefitTemplates,
	insurancePolicies,
	fareProviders,
	fareWatches,
	reminders,
	notifications,
	auditLogs,
	tripCompanions,
	tripChecklists,
	tripChecklistItems,
	tripExpenses,
	segmentAttendees,
	emergencyContacts,
	tripJournalEntries,
	tripDocumentLinks,
	packingTemplates,
	packingTemplateItems,
	tripPolls,
	tripPollOptions,
	tripPollVotes,
	tripBudgetCategories,
	attachments,
	tripExpenseAttachments,
	tripTemplates,
	tripHomeTasks,
	tripMedications,
	tripEntryRequirements,
	tripImportantItems,
	visitedCountries,
	visitedUsStates,
	userSmtpOverrides,
	weatherCache,
	userTwoFactor,
	twoFactorBackupCodes,
	passkeys,
	webauthnChallenges,
	oauthClients,
	oauthCodes,
	oauthTokens
]);
