import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

/**
 * Admin-configured place-search provider for the saved-places prefill:
 * `place_search_provider` ('nominatim' | 'google') and the Google Places API
 * key (`place_search_google_api_key`, encrypted at rest).
 *
 * Both columns are nullable with static defaults — a NOT NULL add rewrites
 * every row against the full target schema (see 0013's note), so readers
 * coalesce null instead: null provider means 'nominatim'.
 */
export const placeSearchProviderMigration: Migration = {
	version: 15,
	name: 'place_search_provider',
	ops: [
		{ kind: 'addColumn', table: 'settings', column: 'place_search_provider' },
		{ kind: 'addColumn', table: 'settings', column: 'place_search_google_api_key' }
	],
	up: (ctx) => {
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'place_search_provider')!);
		ctx.addColumn('settings', settings.columns.find((c) => c.name === 'place_search_google_api_key')!);
	}
};
