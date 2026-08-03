import type { Migration } from '@visorcraft/mongreldb-kit';
import { segments } from '../mongrelSchema';

const daySortOrder = segments.columns.find((c) => c.name === 'day_sort_order')!;

/**
 * Per-day manual order for untimed itinerary segments. Written by the day
 * route optimizer (trip_day_optimize); null means "keep natural order".
 */
export const segmentDaySortOrderMigration: Migration = {
	version: 12,
	name: 'segment_day_sort_order',
	ops: [{ kind: 'addColumn', table: 'segments', column: 'day_sort_order' }],
	up: (ctx) => {
		ctx.addColumn('segments', daySortOrder);
	}
};
