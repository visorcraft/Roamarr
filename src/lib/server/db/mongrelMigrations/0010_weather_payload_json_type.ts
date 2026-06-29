import type { Migration } from '@mongreldb/kit';
import { weatherCache } from '../mongrelSchema';

// `weather_cache.payload_json` was originally created as a `text()` column and
// later redeclared in the schema as `json()`. Fresh databases pick up the json
// type from the table definition, but already-deployed databases still carry
// the column as text. text and json share MongrelDB's Bytes storage, so this
// alterColumn is a metadata-only change (no row rewrite); it brings deployed
// databases onto the json application type recorded by the schema catalog.
const weatherPayloadJsonTypeMigration: Migration = {
	version: 10,
	name: 'weather_cache_payload_json_type',
	ops: [{ kind: 'alterColumn', table: 'weather_cache', column: 'payload_json' }],
	up: (ctx) => {
		ctx.alterColumn(
			'weather_cache',
			'payload_json',
			weatherCache.column('payload_json')
		);
	}
};

export const migrations = [weatherPayloadJsonTypeMigration];
