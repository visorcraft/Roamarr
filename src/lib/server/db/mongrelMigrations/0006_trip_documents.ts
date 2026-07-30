import type { Migration } from '@visorcraft/mongreldb-kit';
import { tripDocuments } from '../mongrelSchema';

/**
 * Trip/segment file documents: encrypted PDF/image attachments scoped to a
 * trip, optionally to one itinerary segment (null segment_id = trip-level).
 */
export const tripDocumentsMigration: Migration = {
	version: 6,
	name: 'trip_documents',
	ops: [{ kind: 'createTable', name: 'trip_documents' }],
	up: (ctx) => {
		ctx.ensureTable(tripDocuments);
	}
};
