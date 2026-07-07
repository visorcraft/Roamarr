import { kit } from '$lib/server/db';
import {
	settings,
	benefitTemplates,
	SESSION_COOKIE_SAME_SITE_VALUES
} from '$lib/server/db/mongrelSchema';
import { eq } from '@visorcraft/mongreldb-kit';
import type { Row, Update } from '@visorcraft/mongreldb-kit';

export type SessionCookieSameSite = (typeof SESSION_COOKIE_SAME_SITE_VALUES)[number];

export type Settings = {
	id: number;
	instanceName: string;
	setupComplete: boolean;
	allowRegistration: boolean;
	defaultTimezone: string;
	defaultCurrency: string;
	defaultFlightCheckinLeadHours: number;
	defaultDocumentExpiryLeadDays: number;
	smtpHost: string | null;
	smtpPort: number | null;
	smtpSecurity: string | null;
	smtpUser: string | null;
	smtpPass: string | null;
	smtpFrom: string | null;
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
	defaultFlightCheckinLeadHours: 'default_flight_checkin_lead_hours',
	defaultDocumentExpiryLeadDays: 'default_document_expiry_lead_days',
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
	'smtp_port'
]);

function nullableText(value: string | null): string | null {
	return value === '' ? null : value;
}

function toSettingsRow(row: Row<typeof settings>): Settings {
	return {
		id: Number(row.id),
		instanceName: row.instance_name,
		setupComplete: row.setup_complete,
		allowRegistration: row.allow_registration,
		defaultTimezone: row.default_timezone,
		defaultCurrency: row.default_currency,
		defaultFlightCheckinLeadHours: Number(row.default_flight_checkin_lead_hours),
		defaultDocumentExpiryLeadDays: Number(row.default_document_expiry_lead_days),
		smtpHost: nullableText(row.smtp_host),
		smtpPort: row.smtp_port == null || row.smtp_port === 0n ? null : Number(row.smtp_port),
		smtpSecurity: nullableText(row.smtp_security),
		smtpUser: nullableText(row.smtp_user),
		smtpPass: nullableText(row.smtp_pass),
		smtpFrom: nullableText(row.smtp_from),
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

export function getSettings(): Settings {
	const rows = kit.selectFrom(settings).executeSync();
	if (rows.length === 0) {
		kit
			.insertInto(settings)
			.values({
				id: 1n,
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
				maps_tile_api_key: null
			})
			.executeSync();
		return getSettings();
	}
	return toSettingsRow(rows[0]);
}

export function updateSettings(patch: SettingsPatch): void {
	getSettings(); // ensure the singleton settings row exists before patching
	kit.updateTable(settings).set(toKitSettingsPatch(patch)).executeSync();
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
