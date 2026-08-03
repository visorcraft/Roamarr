import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings, users } from '../mongrelSchema';

/**
 * OIDC single sign-on: admin-configured provider settings on the singleton
 * settings row, plus `users.oidc_sub` to remember the provider subject for
 * accounts linked via SSO.
 *
 * All columns are nullable with static defaults, so no NOT NULL backfill
 * rewrite runs: a backfill writes cells for every column in the current
 * schema — including columns added by LATER migrations that do not exist
 * natively yet — which breaks in-place upgrades of older databases.
 */
export const oidcSsoMigration: Migration = {
	version: 13,
	name: 'oidc_sso',
	ops: [
		{ kind: 'addColumn', table: 'settings', column: 'oidc_discovery_url' },
		{ kind: 'addColumn', table: 'settings', column: 'oidc_client_id' },
		{ kind: 'addColumn', table: 'settings', column: 'oidc_client_secret' },
		{ kind: 'addColumn', table: 'settings', column: 'oidc_display_name' },
		{ kind: 'addColumn', table: 'settings', column: 'oidc_enabled' },
		{ kind: 'addColumn', table: 'users', column: 'oidc_sub' }
	],
	up: (ctx) => {
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'oidc_discovery_url')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'oidc_client_id')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'oidc_client_secret')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'oidc_display_name')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'oidc_enabled')!);
		ctx.addColumn('users', users.columns.find((c) => c.name === 'oidc_sub')!);
	}
};
