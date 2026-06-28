import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never, kit: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	getSettings,
	updateSettings,
	ensureDefaultBenefitTemplates,
	listBenefitTemplates,
	getBenefitTemplateById,
	createBenefitTemplate,
	updateBenefitTemplate,
	deleteBenefitTemplate
} from './settingsRepo';
import { settings, benefitTemplates } from '$lib/server/db/mongrelSchema';
import { eq } from '@mongreldb/kit';

test('getSettings returns the singleton row with defaults', () => {
	const s = getSettings();
	expect(s.id).toBe(1);
	expect(s.instanceName).toBe('Roamarr');
	expect(s.setupComplete).toBe(false);
	expect(s.defaultCurrency).toBe('USD');
	expect(s.defaultFlightCheckinLeadHours).toBe(24);
	expect(s.defaultDocumentExpiryLeadDays).toBe(90);
});

test('updateSettings patches the singleton row', () => {
	updateSettings({
		instanceName: 'Trips',
		allowRegistration: true,
		defaultTimezone: 'America/New_York',
		defaultFlightCheckinLeadHours: 48,
		defaultDocumentExpiryLeadDays: 60,
		smtpHost: 'smtp.example.com',
		smtpPort: 587
	});
	const s = getSettings();
	expect(s.instanceName).toBe('Trips');
	expect(s.allowRegistration).toBe(true);
	expect(s.defaultTimezone).toBe('America/New_York');
	expect(s.defaultFlightCheckinLeadHours).toBe(48);
	expect(s.defaultDocumentExpiryLeadDays).toBe(60);
	expect(s.smtpHost).toBe('smtp.example.com');
	expect(s.smtpPort).toBe(587);

	const raw = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(settings)
		.where(eq(settings.id, 1n))
		.executeSync()[0];
	expect(raw.instance_name).toBe('Trips');
	expect(raw.smtp_port).toBe(587n);
});

test('ensureDefaultBenefitTemplates seeds once and is idempotent', () => {
	ensureDefaultBenefitTemplates();
	expect(listBenefitTemplates()).toHaveLength(3);
	ensureDefaultBenefitTemplates();
	ensureDefaultBenefitTemplates();
	expect(listBenefitTemplates()).toHaveLength(3);
});

test('getBenefitTemplateById returns a template or undefined', () => {
	const templates = listBenefitTemplates();
	const first = templates[0];
	expect(getBenefitTemplateById(first.id)).toEqual(first);
	expect(getBenefitTemplateById(99999)).toBeUndefined();
});

test('create, update, and delete benefit templates', () => {
	const created = createBenefitTemplate({
		benefitType: 'other',
		name: 'Test template',
		coverageAmount: 12345,
		currency: 'GBP',
		description: 'Test description'
	});
	expect(created.benefitType).toBe('other');
	expect(created.coverageAmount).toBe(12345);
	expect(created.currency).toBe('GBP');

	const updated = updateBenefitTemplate(created.id, { name: 'Renamed', coverageAmount: null });
	expect(updated?.name).toBe('Renamed');
	expect(updated?.coverageAmount).toBeNull();

	const countBefore = listBenefitTemplates().length;
	const deleted = deleteBenefitTemplate(created.id);
	expect(deleted).toBe(1n);
	expect(listBenefitTemplates()).toHaveLength(countBefore - 1);
	expect(getBenefitTemplateById(created.id)).toBeUndefined();
});

test('updateSettings preserves omitted fields', () => {
	updateSettings({ smtpPass: 'encrypted-secret' });
	const before = getSettings().smtpPass;
	updateSettings({ instanceName: 'Preserved' });
	const after = getSettings();
	expect(after.instanceName).toBe('Preserved');
	expect(after.smtpPass).toBe(before);
});
