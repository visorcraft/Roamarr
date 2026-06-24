import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	listBenefitTemplates,
	getBenefitTemplate,
	ensureDefaultBenefitTemplates
} from './benefitTemplates';
import { benefitTemplates } from './db/schema';
import { count } from 'drizzle-orm';

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
	const db = (ctx as { db: import('./db').DB }).db;
	ensureDefaultBenefitTemplates(db);
	ensureDefaultBenefitTemplates(db);
	const total = db.select({ count: count() }).from(benefitTemplates).get()!.count;
	expect(total).toBe(3);
});
