import { test, expect } from 'vitest';
import { freshDb } from '../../../../tests/helpers';
import { users } from './mongrelSchema';

test('role CHECK rejects bad enum', () => {
	const { kit } = freshDb();
	expect(() =>
		kit
			.insertInto(users)
			.values({ email: 'a@b.c', password_hash: 'x', display_name: 'A', role: 'wizard' } as never)
			.executeSync()
	).toThrow();
});
