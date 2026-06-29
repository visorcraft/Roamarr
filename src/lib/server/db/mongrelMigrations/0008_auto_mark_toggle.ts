import type { Migration } from '@mongreldb/kit';
import { users } from '../mongrelSchema';

const autoMarkToggleMigration: Migration = {
	version: 8,
	name: 'auto_mark_visited_toggle',
	up: (ctx) => {
		const col = users.columns.find((c) => c.name === 'auto_mark_visited');
		if (col) ctx.addColumn('users', col);
	}
};

export const migrations = [autoMarkToggleMigration];
