import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('$lib/server/db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import { actions } from './+page.server';
import { users, trips } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

function locals(user: { id: number }) {
	return { user } as App.Locals;
}

function formData(obj: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(obj)) f.append(k, v);
	return f;
}

function makeEvent(form: FormData, params: Record<string, string> = {}, userId = 1) {
	return {
		request: new Request('http://localhost/trips/new', { method: 'POST', body: form }),
		params,
		locals: locals({ id: userId }),
		url: new URL('http://localhost/trips/new')
	} as any;
}

test('creates a trip with valid data', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'a@x.c', passwordHash: 'x', displayName: 'A' }).returning().get();
	const form = formData({
		name: 'Summer Escape',
		destination: 'Lisbon',
		startDate: '2026-07-01',
		endDate: '2026-07-10',
		notes: 'note',
		defaultVisibility: 'public'
	});
	await expect(actions.default(makeEvent(form))).rejects.toMatchObject({
		status: 303,
		location: expect.stringMatching(/^\/trips\/\d+$/)
	});
	const t = db.select().from(trips).where(eq(trips.ownerId, u.id)).get();
	expect(t).toBeDefined();
	expect(t!.name).toBe('Summer Escape');
	expect(t!.publicToken).toBeTruthy();
});

test('rejects missing name and invalid date range', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'b@x.c', passwordHash: 'x', displayName: 'B' }).returning().get();
	const form = formData({
		name: '  ',
		startDate: '2026-07-10',
		endDate: '2026-07-01',
		defaultVisibility: 'private'
	});
	const result = (await actions.default(makeEvent(form, {}, u.id))) as {
		status: number;
		data: { error: string; errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.name).toBe('name is required');
	expect(result.data.errors.startDate).toBe('startDate must be on or before endDate');
	expect(db.select().from(trips).where(eq(trips.ownerId, u.id)).all()).toHaveLength(0);
});

test('rejects invalid visibility enum', async () => {
	const db = (ctx as { db: import('$lib/server/db').DB }).db;
	const u = db.insert(users).values({ email: 'c@x.c', passwordHash: 'x', displayName: 'C' }).returning().get();
	const form = formData({ name: 'T', defaultVisibility: 'secret' });
	const result = (await actions.default(makeEvent(form, {}, u.id))) as {
		status: number;
		data: { errors: Record<string, string> };
	};
	expect(result.status).toBe(400);
	expect(result.data.errors.defaultVisibility).toContain('private');
});

import { render } from 'svelte/server';
import NewTripPage from './+page.svelte';

test('new trip form highlights invalid fields and shows per-field errors', () => {
	const { body } = render(NewTripPage, {
		props: {
			data: { tripTemplates: [] } as any,
			form: {
				error: 'Please fix the highlighted fields.',
				errors: { name: 'name is required', startDate: 'startDate must be on or before endDate' }
			}
		}
	});
	expect(body).toContain('input-error');
	expect(body).toContain('name is required');
	expect(body).toContain('startDate must be on or before endDate');
});
