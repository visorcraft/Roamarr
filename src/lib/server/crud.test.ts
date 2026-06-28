import { test, expect, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ db: null as never, sqlite: null as never }));
vi.mock('./db', async () => {
	const { freshDb } = await import('../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});
import { kit } from './db';

import { makeUser, makeTrip } from '../../../tests/helpers';


import { tripCrudFactory } from './crud';
import { tripHomeTasks } from './db/mongrelSchema';
import { Validator, formFail } from './validation';

test('tripCrudFactory lists, adds and removes rows scoped to a trip', () => {
	const db = (ctx as { db: import('./db').DB }).db;
	const user = makeUser(kit, { email: 'u@x.c', passwordHash: 'x', displayName: 'U' });
	const trip = makeTrip(kit, user.id, { name: 'T' });

	const crud = tripCrudFactory({
		table: tripHomeTasks,
		auditEntity: 'home_task',
		validate: (input: { text: string }) => {
			const v = new Validator();
			v.requiredString(input.text, 'text', { max: 200 });
			if (!v.ok()) throw formFail(v);
		},
		buildInsert: (input, tripId) => ({ trip_id: BigInt(tripId), text: input.text } as never)
	});

	expect(crud.list(trip.id)).toHaveLength(0);
	const inserted = crud.add(user.id, trip.id, { text: 'Pack' });
	expect(inserted.text).toBe('Pack');
	expect(crud.list(trip.id)).toHaveLength(1);
	crud.remove(user.id, trip.id, Number(inserted.id));
	expect(crud.list(trip.id)).toHaveLength(0);
});

test('tripCrudFactory validate throws on bad input', () => {
	const crud = tripCrudFactory({
		table: tripHomeTasks,
		auditEntity: 'home_task',
		validate: (input: { text: string }) => {
			const v = new Validator();
			v.requiredString(input.text, 'text', { max: 200 });
			if (!v.ok()) throw formFail(v);
		},
		buildInsert: (input, tripId) => ({ trip_id: BigInt(tripId), text: input.text } as never)
	});
	expect(() => crud.add(1, 1, { text: '' })).toThrow();
});
