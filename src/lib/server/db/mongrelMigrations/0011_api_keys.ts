import type { Migration } from '@visorcraft/mongreldb-kit';
import { apiKeys } from '../mongrelSchema';

/**
 * Personal API keys: long-lived bearer credentials (SHA-256 hash stored,
 * plaintext shown once at creation) usable on /api/* and /mcp. Rows are
 * kept after revocation for audit.
 */
export const apiKeysMigration: Migration = {
	version: 11,
	name: 'api_keys',
	ops: [{ kind: 'createTable', name: 'api_keys' }],
	up: (ctx) => {
		ctx.ensureTable(apiKeys);
	}
};
