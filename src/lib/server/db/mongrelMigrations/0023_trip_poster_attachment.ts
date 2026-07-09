import type { Migration } from '@visorcraft/mongreldb-kit';
import { trips } from '../mongrelSchema';

const tripPosterAttachmentMigration: Migration = {
	version: 23,
	name: 'trip_poster_attachment',
	up: (ctx) => {
		const col = trips.columns.find((c) => c.name === 'poster_attachment_id');
		if (col && !ctx.db.tableColumns('trips').includes('poster_attachment_id')) {
			ctx.addColumn('trips', col);
		}
	}
};

export const migrations = [tripPosterAttachmentMigration];
