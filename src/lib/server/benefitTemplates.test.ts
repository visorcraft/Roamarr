import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listBenefitTemplates,
	getBenefitTemplate,
	ensureDefaultBenefitTemplates,
	createBenefitTemplate,
	updateBenefitTemplate,
	deleteBenefitTemplate
} from './benefitTemplates';
import { benefitTemplates } from './db/mongrelSchema';
import { eq } from '@mongreldb/kit';

test('default templates are seeded by migrations', () => {
	const templates = listBenefitTemplates();
	expect(templates.map((t) => t.benefitType)).toEqual([
		'trip_delay',
		'baggage_delay',
		'trip_cancellation'
	]);
	expect(templates[0].currency).toBe('USD');
});

test('getBenefitTemplate returns a template by id', () => {
	const templates = listBenefitTemplates();
	const first = templates[0];
	expect(getBenefitTemplate(first.id)).toEqual(first);
	expect(getBenefitTemplate(99999)).toBeUndefined();
});

test('ensureDefaultBenefitTemplates is idempotent', () => {
	ensureDefaultBenefitTemplates();
	ensureDefaultBenefitTemplates();
	const total = listBenefitTemplates().length;
	expect(total).toBe(3);
});

test('create, update, and delete benefit templates', () => {
	const created = createBenefitTemplate({
		benefitType: 'other',
		name: 'Custom benefit',
		coverageAmount: 25000,
		currency: 'EUR',
		description: 'A custom template'
	});
	expect(created.name).toBe('Custom benefit');
	expect(created.coverageAmount).toBe(25000);

	const updated = updateBenefitTemplate(created.id, { name: 'Updated custom', coverageAmount: 30000 });
	expect(updated?.name).toBe('Updated custom');
	expect(updated?.coverageAmount).toBe(30000);

	deleteBenefitTemplate(created.id);
	expect(getBenefitTemplate(created.id)).toBeUndefined();
});

test('deleteBenefitTemplate returns the number of deleted rows', () => {
	const rowsBefore = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(benefitTemplates)
		.selectCount()
		.executeSync();
	const created = createBenefitTemplate({
		benefitType: 'other',
		name: 'To delete',
		coverageAmount: 1,
		currency: 'USD',
		description: null
	});
	const deleted = deleteBenefitTemplate(created.id);
	expect(deleted).toBe(1n);
	const rowsAfter = (ctx as { kit: import('@mongreldb/kit').KitDatabase }).kit
		.selectFrom(benefitTemplates)
		.selectCount()
		.executeSync();
	expect(rowsAfter).toBe(rowsBefore);
});
