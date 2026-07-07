import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

const sessionCookieSameSiteMigration: Migration = {
	version: 15,
	name: 'session_cookie_same_site',
	up: (ctx) => {
		const col = settings.columns.find((c) => c.name === 'session_cookie_same_site');
		if (col) ctx.addColumn('settings', col);
	}
};

export const migrations = [sessionCookieSameSiteMigration];
