import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

const oauthClientAllowListMigration: Migration = {
	version: 11,
	name: 'oauth_client_allow_list',
	up: (ctx) => {
		const col = settings.columns.find((c) => c.name === 'oauth_client_allow_list');
		if (col) ctx.addColumn('settings', col);
	}
};

export const migrations = [oauthClientAllowListMigration];
