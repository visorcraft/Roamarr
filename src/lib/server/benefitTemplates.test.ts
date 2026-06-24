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
	createBenefitTemplate,
	updateBenefitTemplate,
	deleteBenefitTemplate,
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

function expectAdminOnly(fn: () => unknown) {
	try {
		fn();
		expect.fail('should have thrown');
	} catch (e: any) {
		expect(e.status).toBe(403);
	}
}

test('template mutations require admin role', () => {
	const user = { role: 'user' };
	const admin = { role: 'admin' };

	expectAdminOnly(() =>
		createBenefitTemplate(user, {
			benefitType: 'other',
			name: 'User template',
			coverageAmount: 100,
			currency: 'USD'
		})
	);

	const created = createBenefitTemplate(admin, {
		benefitType: 'other',
		name: 'Admin template',
		coverageAmount: 100,
		currency: 'USD'
	});
	expect(created.name).toBe('Admin template');

	expectAdminOnly(() => updateBenefitTemplate(user, created.id, { name: 'Hacked template' }));
	updateBenefitTemplate(admin, created.id, { name: 'Updated template' });
	expect(getBenefitTemplate(created.id)!.name).toBe('Updated template');

	expectAdminOnly(() => deleteBenefitTemplate(user, created.id));
	deleteBenefitTemplate(admin, created.id);
	expect(getBenefitTemplate(created.id)).toBeUndefined();
});

test('ensureDefaultBenefitTemplates is idempotent', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	ensureDefaultBenefitTemplates(db);
	ensureDefaultBenefitTemplates(db);
	const total = db.select({ count: count() }).from(benefitTemplates).get()!.count;
	expect(total).toBe(3);
});
