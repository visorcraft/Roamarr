import type { Migration } from '@visorcraft/mongreldb-kit';
import { tripDayNotes } from '../mongrelSchema';

/**
 * Per-day itinerary notes: one optional note (icon + body) per trip day.
 * Rows cascade-delete with the trip; (trip_id, date) is unique.
 */
export const tripDayNotesMigration: Migration = {
	version: 8,
	name: 'trip_day_notes',
	ops: [{ kind: 'createTable', name: 'trip_day_notes' }],
	up: (ctx) => {
		ctx.ensureTable(tripDayNotes);
	}
};
