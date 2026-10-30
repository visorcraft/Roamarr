import type { Migration } from '@visorcraft/mongreldb-kit';
import { geonamesCities } from '../mongrelSchema';

export const cityAlternateNamesMigration: Migration = {
	version: 17,
	name: 'city_alternate_names',
	ops: [{ kind: 'addColumn', table: 'geonames_cities', column: 'alternate_names' }],
	up: (ctx) => {
		ctx.addColumn('geonames_cities', geonamesCities.columns.find((c) => c.name === 'alternate_names')!);
	}
};
