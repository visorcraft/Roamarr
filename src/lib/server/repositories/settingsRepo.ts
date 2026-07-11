import { kit } from '$lib/server/db';
import {
	settings,
	benefitTemplates,
	SESSION_COOKIE_SAME_SITE_VALUES
} from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import type { Row, Update, Insert } from '@visorcraft/mongreldb-kit';

export type SessionCookieSameSite = (typeof SESSION_COOKIE_SAME_SITE_VALUES)[number];

export type Settings = {
	id: number;
	instanceName: string;
	setupComplete: boolean;
	allowRegistration: boolean;
	defaultTimezone: string;
	defaultCurrency: string;
	defaultDateFormat: string;
	defaultDatetimeFormat: string;
	defaultFlightCheckinLeadHours: number;
	defaultDocumentExpiryLeadDays: number;
	emailPollIntervalMinutes: number;
	smtpHost: string | null;
	smtpPort: number | null;
	smtpSecurity: string | null;
	smtpUser: string | null;
	smtpPass: string | null;
	smtpFrom: string | null;
	allowUserImap: boolean;
	allowUserSmtp: boolean;
	allowUserParsingProviders: boolean;
	globalImapEnabled: boolean;
	globalImapHost: string | null;
	globalImapPort: number | null;
	globalImapSecurity: string;
	globalImapUsername: string | null;
	globalImapPassword: string | null;
	globalImapMailbox: string;
	globalImapLastUid: number | null;
	globalImapLastPolledAt: string | null;
	globalImapLastError: string | null;
	globalAiEnabled: boolean;
	globalAiAuthMode: 'token' | 'oauth';
	globalAiBaseUrl: string | null;
	globalAiModel: string | null;
	globalAiToken: string | null;
	globalAiTokenUrl: string | null;
	globalAiClientId: string | null;
	globalAiClientSecret: string | null;
	globalAiScope: string | null;
	webhookUrl: string | null;
	mapsEnabled: boolean;
	mapsGeonamesImportedAt: string | null;
	mapsTileProvider: string;
	mapsTileUrl: string | null;
	mapsTileAttribution: string | null;
	mapsTileApiKey: string | null;
	sessionCookieSameSite: SessionCookieSameSite;
	oauthClientAllowList: string[] | null;
};

export type SettingsPatch = Partial<Omit<Settings, 'id'>>;

export type BenefitTemplate = {
	id: number;
	benefitType: string;
	name: string;
	coverageAmount: number | null;
	currency: string;
	description: string | null;
};

export type BenefitTemplateInput = Omit<BenefitTemplate, 'id'>;
export type BenefitTemplatePatch = Partial<BenefitTemplateInput>;

const SETTINGS_KEY_MAP: Record<string, string> = {
	instanceName: 'instance_name',
	setupComplete: 'setup_complete',
	allowRegistration: 'allow_registration',
	defaultTimezone: 'default_timezone',
	defaultCurrency: 'default_currency',
	defaultDateFormat: 'default_date_format',
	defaultDatetimeFormat: 'default_datetime_format',
	defaultFlightCheckinLeadHours: 'default_flight_checkin_lead_hours',
	defaultDocumentExpiryLeadDays: 'default_document_expiry_lead_days',
	emailPollIntervalMinutes: 'email_poll_interval_minutes',
	smtpHost: 'smtp_host',
	smtpPort: 'smtp_port',
	smtpSecurity: 'smtp_security',
	smtpUser: 'smtp_user',
	smtpPass: 'smtp_pass',
	smtpFrom: 'smtp_from',
	webhookUrl: 'webhook_url',
	mapsEnabled: 'maps_enabled',
	mapsGeonamesImportedAt: 'maps_geonames_imported_at',
	mapsTileProvider: 'maps_tile_provider',
	mapsTileUrl: 'maps_tile_url',
	mapsTileAttribution: 'maps_tile_attribution',
	mapsTileApiKey: 'maps_tile_api_key',
	sessionCookieSameSite: 'session_cookie_same_site',
	oauthClientAllowList: 'oauth_client_allow_list'
};

const SETTINGS_INT_FIELDS = new Set([
	'default_flight_checkin_lead_hours',
	'default_document_expiry_lead_days',
	'email_poll_interval_minutes',
	'smtp_port'
]);

const EMAIL_SETTING_KEYS = [
	'allowUserImap', 'allowUserSmtp', 'allowUserParsingProviders', 'globalImapEnabled',
	'globalImapHost', 'globalImapPort', 'globalImapSecurity', 'globalImapUsername',
	'globalImapPassword', 'globalImapMailbox', 'globalImapLastUid', 'globalImapLastPolledAt',
	'globalImapLastError', 'globalAiEnabled', 'globalAiAuthMode', 'globalAiBaseUrl', 'globalAiModel', 'globalAiToken',
	'globalAiTokenUrl', 'globalAiClientId', 'globalAiClientSecret', 'globalAiScope'
] as const;

const EMAIL_DEFAULTS = {
	allowUserImap: true, allowUserSmtp: false, allowUserParsingProviders: false,
	globalImapEnabled: true, globalImapHost: null, globalImapPort: null,
	globalImapSecurity: 'ssl/tls', globalImapUsername: null, globalImapPassword: null,
	globalImapMailbox: 'INBOX', globalImapLastUid: null, globalImapLastPolledAt: null,
	globalImapLastError: null, globalAiEnabled: false, globalAiAuthMode: 'token' as const, globalAiBaseUrl: null,
	globalAiModel: null, globalAiToken: null, globalAiTokenUrl: null, globalAiClientId: null,
	globalAiClientSecret: null, globalAiScope: null
};

function nullableText(value: string | null): string | null {
	return value === '' ? null : value;
}

function toSettingsRow(row: Row<typeof settings>): Settings {
	const email = { ...EMAIL_DEFAULTS, ...(row.email_processing_config ? JSON.parse(row.email_processing_config as string) : {}) };
	return {
		id: Number(row.id),
		instanceName: row.instance_name,
		setupComplete: row.setup_complete,
		allowRegistration: row.allow_registration,
		defaultTimezone: row.default_timezone,
		defaultCurrency: row.default_currency,
		defaultDateFormat: (row.default_date_format as unknown as string) || 'yyyy-MM-dd',
		defaultDatetimeFormat: (row.default_datetime_format as unknown as string) || 'yyyy-MM-dd h:mm a',
		defaultFlightCheckinLeadHours:
			row.default_flight_checkin_lead_hours == null ? 24 : Number(row.default_flight_checkin_lead_hours),
		defaultDocumentExpiryLeadDays:
			row.default_document_expiry_lead_days == null ? 90 : Number(row.default_document_expiry_lead_days),
		emailPollIntervalMinutes: Number(row.email_poll_interval_minutes ?? 5n),
		smtpHost: nullableText(row.smtp_host),
		smtpPort: row.smtp_port == null || row.smtp_port === 0n ? null : Number(row.smtp_port),
		smtpSecurity: nullableText(row.smtp_security),
		smtpUser: nullableText(row.smtp_user),
		smtpPass: nullableText(row.smtp_pass),
		smtpFrom: nullableText(row.smtp_from),
		...email,
		webhookUrl: nullableText(row.webhook_url),
		mapsEnabled: row.maps_enabled,
		mapsGeonamesImportedAt: nullableText(row.maps_geonames_imported_at),
		mapsTileProvider: row.maps_tile_provider,
		mapsTileUrl: nullableText(row.maps_tile_url),
		mapsTileAttribution: nullableText(row.maps_tile_attribution),
		mapsTileApiKey: nullableText(row.maps_tile_api_key),
		sessionCookieSameSite: (row.session_cookie_same_site as SessionCookieSameSite) ?? 'lax',
		oauthClientAllowList: row.oauth_client_allow_list
			? (JSON.parse(row.oauth_client_allow_list as string) as string[])
			: null
	};
}

function toKitSettingsPatch(patch: SettingsPatch): Update<typeof settings> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		const kitKey = SETTINGS_KEY_MAP[key] ?? key;
		if (SETTINGS_INT_FIELDS.has(kitKey) && value !== null) {
			out[kitKey] = BigInt(value as number);
		} else if (kitKey === 'oauth_client_allow_list' && value !== null) {
			out[kitKey] = JSON.stringify(value);
		} else {
			out[kitKey] = value;
		}
	}
	return out as Update<typeof settings>;
}

function toBenefitTemplateRow(row: Row<typeof benefitTemplates>): BenefitTemplate {
	return {
		id: Number(row.id),
		benefitType: row.benefit_type,
		name: row.name,
		coverageAmount: row.coverage_amount == null ? null : Number(row.coverage_amount),
		currency: row.currency,
		description: nullableText(row.description)
	};
}

function toKitBenefitTemplateInput(input: BenefitTemplateInput): any {
	return {
		benefit_type: input.benefitType,
		name: input.name,
		coverage_amount: input.coverageAmount == null ? null : BigInt(input.coverageAmount),
		currency: input.currency,
		description: input.description ?? null
	};
}

function toKitBenefitTemplatePatch(patch: BenefitTemplatePatch): Update<typeof benefitTemplates> {
	const out: Record<string, unknown> = {};
	if (patch.benefitType !== undefined) out.benefit_type = patch.benefitType;
	if (patch.name !== undefined) out.name = patch.name;
	if (patch.coverageAmount !== undefined) {
		out.coverage_amount = patch.coverageAmount == null ? null : BigInt(patch.coverageAmount);
	}
	if (patch.currency !== undefined) out.currency = patch.currency;
	if (patch.description !== undefined) out.description = patch.description ?? null;
	return out as Update<typeof benefitTemplates>;
}

const DEFAULT_BENEFIT_TEMPLATES: BenefitTemplateInput[] = [
	{
		benefitType: 'trip_delay',
		name: 'Trip delay reimbursement',
		coverageAmount: 50000,
		currency: 'USD',
		description: 'Reimburses meals, lodging and transport when a trip is delayed.'
	},
	{
		benefitType: 'baggage_delay',
		name: 'Baggage delay reimbursement',
		coverageAmount: 10000,
		currency: 'USD',
		description: 'Reimburses essential purchases when checked baggage is delayed.'
	},
	{
		benefitType: 'trip_cancellation',
		name: 'Trip cancellation reimbursement',
		coverageAmount: 100000,
		currency: 'USD',
		description: 'Reimburses non-refundable trip costs if you cancel for a covered reason.'
	}
];

function settingsRowNeedsRepair(row: Record<string, unknown>): boolean {
	for (const col of settings.columns) {
		if (settings.primaryKey.includes(col.name)) continue;
		const v = row[col.name];
		if (v === null || v === undefined) {
			if (!col.nullable) return true;
		} else {
			// Accept any value whose JS type matches the column's storage type.
			// `json` columns accept any JSON-serializable value (string, number,
			// boolean, array, object). Unknown storage types are accepted.
			const ok =
				(col.storageType === 'bool' && typeof v === 'boolean') ||
				(col.storageType === 'int64' && typeof v === 'bigint') ||
				(col.storageType === 'float64' && typeof v === 'number') ||
				(col.storageType === 'text' && typeof v === 'string') ||
				(col.storageType === 'timestamp' && typeof v === 'string') ||
				(col.storageType === 'date' && typeof v === 'string') ||
				(col.storageType === 'bytes' && v instanceof Uint8Array) ||
				(col.storageType === 'json') ||
				(col.storageType === 'json_native') ||
				!['bool', 'int64', 'float64', 'text', 'timestamp', 'date', 'bytes', 'json', 'json_native'].includes(col.storageType);
			if (!ok) return true;
		}
	}
	return false;
}

function rebuildSettingsRow(existing: Record<string, unknown>): void {
	// Hardcoded defaults for every non-nullable column. We can't rely on
	// col.default at runtime because the engine sentinel (null/0n) may
	// interfere with the kit's default-resolution path. These values MUST
	// stay in sync with mongrelSchema.ts.
	const HARDCODED_DEFAULTS: Record<string, unknown> = {
		id: existing.id ?? 1n,
		instance_name: 'Roamarr',
		setup_complete: false,
		allow_registration: false,
		default_timezone: 'UTC',
		default_currency: 'USD',
		default_date_format: 'yyyy-MM-dd',
		default_datetime_format: 'yyyy-MM-dd h:mm a',
		default_flight_checkin_lead_hours: 24n,
		default_document_expiry_lead_days: 90n,
		email_poll_interval_minutes: 5n,
		maps_enabled: false,
		maps_tile_provider: 'openstreetmap',
		session_cookie_same_site: 'lax',
		smtp_host: null,
		smtp_port: null,
		smtp_security: null,
		smtp_user: null,
		smtp_pass: null,
		smtp_from: null,
		email_processing_config: null,
		webhook_url: null,
		maps_geonames_imported_at: null,
		maps_tile_url: null,
		maps_tile_attribution: null,
		maps_tile_api_key: null,
		oauth_client_allow_list: null
	};

	const rebuilt: Record<string, unknown> = {};
	for (const col of settings.columns) {
		const current = existing[col.name];
		const def = HARDCODED_DEFAULTS[col.name];

		// Keep the current value if it's valid; otherwise use the hardcoded default
		const ok = current !== null && current !== undefined &&
			((col.storageType === 'bool' && typeof current === 'boolean') ||
				(col.storageType === 'int64' && typeof current === 'bigint') ||
				(col.storageType === 'float64' && typeof current === 'number') ||
				(col.storageType === 'text' && typeof current === 'string') ||
				(col.storageType === 'timestamp' && typeof current === 'string') ||
				(col.storageType === 'date' && typeof current === 'string') ||
				(col.storageType === 'bytes' && current instanceof Uint8Array) ||
				(col.storageType === 'json') ||
				(col.storageType === 'json_native'));
		rebuilt[col.name] = ok ? current : def;
	}

	kit.deleteFrom(settings).where(eq(settings.id, rebuilt.id as bigint)).executeSync();
	kit.insertInto(settings).values(rebuilt as Insert<typeof settings>).executeSync();
}

export function getSettings(): Settings {
	const rows = kit.selectFrom(settings).executeSync();
	if (rows.length === 0) {
		kit
			.insertInto(settings)
			.values({
				id: 1n,
				instance_name: 'Roamarr',
				setup_complete: false,
				allow_registration: false,
				default_timezone: 'UTC',
				default_currency: 'USD',
				default_date_format: 'yyyy-MM-dd',
				default_datetime_format: 'yyyy-MM-dd h:mm a',
				default_flight_checkin_lead_hours: 24n,
				default_document_expiry_lead_days: 90n,
				maps_enabled: false,
				maps_tile_provider: 'openstreetmap',
				session_cookie_same_site: 'lax',
				smtp_host: null,
				smtp_port: null,
				smtp_security: null,
				smtp_user: null,
				smtp_pass: null,
				smtp_from: null,
				webhook_url: null,
				maps_geonames_imported_at: null,
				maps_tile_url: null,
				maps_tile_attribution: null,
				maps_tile_api_key: null,
				oauth_client_allow_list: null
			} as Insert<typeof settings>)
			.executeSync();
		return getSettings();
	}
	const row = rows[0] as Record<string, unknown>;
	if (settingsRowNeedsRepair(row)) {
		rebuildSettingsRow(row);
		return getSettings();
	}
	return toSettingsRow(rows[0]);
}

export function updateSettings(patch: SettingsPatch): void {
	const rows = kit.selectFrom(settings).executeSync();
	if (rows.length === 0) {
		getSettings();
		return updateSettings(patch);
	}

	// Don't use kit.updateTable — it validates the WHOLE merged row and fails
	// if any pre-existing column has a wrong-typed value. Instead, read the
	// current row, merge the patch, fix any bad values, then delete +
	// re-insert. insertInto only validates the new row, which is clean.
	const current = rows[0] as Record<string, unknown>;
	const patchCopy = { ...patch } as Record<string, unknown>;
	const storedEmail = current.email_processing_config;
	const email = { ...EMAIL_DEFAULTS, ...(storedEmail ? JSON.parse(storedEmail as string) : {}) } as Record<string, unknown>;
	let emailChanged = false;
	for (const key of EMAIL_SETTING_KEYS) {
		if (patchCopy[key] !== undefined) { email[key] = patchCopy[key]; emailChanged = true; }
		delete patchCopy[key];
	}
	const kitPatch = toKitSettingsPatch(patchCopy as SettingsPatch) as Record<string, unknown>;
	if (emailChanged) kitPatch.email_processing_config = JSON.stringify(email);
	const merged: Record<string, unknown> = { ...current, ...kitPatch };

	// Fix any wrong-typed values using the same hardcoded defaults
	const HARDCODED_DEFAULTS: Record<string, unknown> = {
		instance_name: 'Roamarr',
		setup_complete: false,
		allow_registration: false,
		default_timezone: 'UTC',
		default_currency: 'USD',
		default_date_format: 'yyyy-MM-dd',
		default_datetime_format: 'yyyy-MM-dd h:mm a',
		default_flight_checkin_lead_hours: 24n,
		default_document_expiry_lead_days: 90n,
		maps_enabled: false,
		maps_tile_provider: 'openstreetmap',
		session_cookie_same_site: 'lax'
	};
	for (const [key, def] of Object.entries(HARDCODED_DEFAULTS)) {
		const v = merged[key];
		if (v === null || v === undefined) {
			merged[key] = def;
		}
	}

	kit.deleteFrom(settings).where(eq(settings.id, current.id as bigint)).executeSync();
	kit.insertInto(settings).values(merged as Insert<typeof settings>).executeSync();
}

export function ensureDefaultBenefitTemplates(): void {
	const count = kit.selectFrom(benefitTemplates).selectCount().executeSync();
	if (count > 0n) return;
	for (const template of DEFAULT_BENEFIT_TEMPLATES) {
		kit.insertInto(benefitTemplates).values(toKitBenefitTemplateInput(template) as any).executeSync();
	}
}

export function listBenefitTemplates(): BenefitTemplate[] {
	const rows = kit.selectFrom(benefitTemplates).executeSync();
	return rows.map(toBenefitTemplateRow);
}

export function getBenefitTemplateById(id: number): BenefitTemplate | undefined {
	const rows = kit
		.selectFrom(benefitTemplates)
		.where(eq(benefitTemplates.id, BigInt(id)))
		.executeSync();
	return rows[0] ? toBenefitTemplateRow(rows[0]) : undefined;
}

export function createBenefitTemplate(input: BenefitTemplateInput): BenefitTemplate {
	const row = kit
		.insertInto(benefitTemplates)
		.values(toKitBenefitTemplateInput(input) as any)
		.executeSync();
	return toBenefitTemplateRow(row);
}

export function updateBenefitTemplate(id: number, patch: BenefitTemplatePatch): BenefitTemplate | null {
	const rows = kit
		.updateTable(benefitTemplates)
		.set(toKitBenefitTemplatePatch(patch))
		.where(eq(benefitTemplates.id, BigInt(id)))
		.executeSync();
	return rows[0] ? toBenefitTemplateRow(rows[0]) : null;
}

export function deleteBenefitTemplate(id: number): bigint {
	return kit.deleteFrom(benefitTemplates).where(eq(benefitTemplates.id, BigInt(id))).executeSync();
}
