import type { Migration } from '@visorcraft/mongreldb-kit';
import { oauthClients, oauthCodes, oauthTokens } from '../mongrelSchema';

const mcpOAuthMigration: Migration = {
	version: 7,
	name: 'mcp_oauth',
	up: (ctx) => {
		ctx.ensureTable(oauthClients);
		ctx.ensureTable(oauthCodes);
		ctx.ensureTable(oauthTokens);
	}
};

export const migrations = [mcpOAuthMigration];
