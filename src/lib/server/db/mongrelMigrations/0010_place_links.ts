import type { Migration } from '@visorcraft/mongreldb-kit';
import { placeLinks } from '../mongrelSchema';

/**
 * External links attached to saved places (label + http(s) URL + notes),
 * mirroring trip_document_links at place scope. Rows cascade-delete with
 * their place.
 */
export const placeLinksMigration: Migration = {
	version: 10,
	name: 'place_links',
	ops: [{ kind: 'createTable', name: 'place_links' }],
	up: (ctx) => {
		ctx.ensureTable(placeLinks);
	}
};
