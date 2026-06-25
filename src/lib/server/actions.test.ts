import { test, expect, vi } from 'vitest';
import { withTripAction } from './actions';
import type { RequestEvent } from '@sveltejs/kit';

function makeEvent(params: Record<string, string>, body: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(body)) form.append(k, v);
	return {
		locals: { user: { id: 1, email: 'a@b.com' } },
		params,
		request: { formData: async () => form }
	} as unknown as RequestEvent;
}

test('withTripAction returns user, tripId and formData', async () => {
	const event = makeEvent({ id: '5' }, { name: 'x' });
	const result = await withTripAction(event);
	expect(result.user.id).toBe(1);
	expect(result.tripId).toBe(5);
	expect(result.formData.get('name')).toBe('x');
});

test('withTripAction throws 404 for invalid trip id', async () => {
	const event = makeEvent({ id: 'abc' }, {});
	await expect(withTripAction(event)).rejects.toMatchObject({ status: 404 });
});

test('withTripAction throws 401 when not signed in', async () => {
	const event = { locals: { user: null }, params: { id: '5' }, request: { formData: async () => new FormData() } } as unknown as RequestEvent;
	await expect(withTripAction(event)).rejects.toMatchObject({ status: 401 });
});
