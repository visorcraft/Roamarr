import type { Migration } from '@visorcraft/mongreldb-kit';
import { placeCategories, places } from '../mongrelSchema';

/**
 * Saved places library: per-user POIs with color-coded categories. Categories
 * cascade-delete with the user; deleting a category unlinks its places
 * (category_id set null) instead of removing them.
 */
export const placesMigration: Migration = {
	version: 7,
	name: 'places',
	ops: [
		{ kind: 'createTable', name: 'place_categories' },
		{ kind: 'createTable', name: 'places' }
	],
	up: (ctx) => {
		ctx.ensureTable(placeCategories);
		ctx.ensureTable(places);
	}
};
