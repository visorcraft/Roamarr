import type { Migration } from '@visorcraft/mongreldb-kit';
import { oauthClients } from '../mongrelSchema';

const oauthScopeHardening: Migration = {
	version: 24,
	name: 'oauth_scope_hardening',
	up: (ctx) => {
		// Add requires_reauth flag (default false) for backward-compat tracking
		// when scopes change. New clients default to false (no reauth needed).
		const col = oauthClients.columns.find((c) => c.name === 'requires_reauth');
		if (col) ctx.addColumn('oauth_clients', col);

		// Flag every existing OAuth client as needing re-authorization. After
		// this migration expands ALL_SCOPES from 8 to 58, any client whose
		// scopes were set before the expansion may now request new scope
		// families (e.g. a client with `['trips:read']` could request
		// `cards:read` if a future reauth filtered against the new ALL_SCOPES
		// fallback). The strict path: re-consent every client once.
		ctx.db.sql(`UPDATE oauth_clients SET requires_reauth = 1`);
	}
};

export const migrations = [oauthScopeHardening];
