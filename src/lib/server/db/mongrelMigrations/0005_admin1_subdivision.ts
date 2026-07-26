import type { Migration } from '@visorcraft/mongreldb-kit';
import { geonamesAdmin1, geonamesCities, segments, trips } from '../mongrelSchema';

const cityAdmin1 = geonamesCities.columns.find((c) => c.name === 'admin1_code')!;
const tripAdmin1 = trips.columns.find((c) => c.name === 'destination_admin1_code')!;
const segAdmin1 = segments.columns.find((c) => c.name === 'admin1_code')!;

/**
 * State/province/territory (GeoNames admin1) support:
 * - city rows keep admin1_code for scoped search/resolve
 * - label table for human-readable subdivision selects
 * - optional subdivision on trips and segments
 */
export const admin1SubdivisionMigration: Migration = {
	version: 5,
	name: 'admin1_subdivision',
	ops: [
		{ kind: 'addColumn', table: 'geonames_cities', column: 'admin1_code' },
		{ kind: 'createTable', name: 'geonames_admin1' },
		{ kind: 'addColumn', table: 'trips', column: 'destination_admin1_code' },
		{ kind: 'addColumn', table: 'segments', column: 'admin1_code' }
	],
	up: (ctx) => {
		ctx.addColumn('geonames_cities', cityAdmin1);
		ctx.ensureTable(geonamesAdmin1);
		ctx.addColumn('trips', tripAdmin1);
		ctx.addColumn('segments', segAdmin1);
	}
};
