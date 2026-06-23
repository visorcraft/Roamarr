import { test, expect } from 'vitest';
import { freshDb } from '../../../../tests/helpers';
import { users } from './schema';
import { sql } from 'drizzle-orm';

test('foreign_keys pragma is ON', () => {
	const { sqlite } = freshDb();
	expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
});

test('role CHECK rejects bad enum', () => {
	const { db } = freshDb();
	expect(() =>
		db
			.insert(users)
			.values({ email: 'a@b.c', passwordHash: 'x', displayName: 'A', role: 'wizard' })
			.run()
	).toThrow();
});
