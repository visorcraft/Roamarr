import type { Migration } from '@visorcraft/mongreldb-kit';
import { tripCompanions } from '../mongrelSchema';

const tripCompanionsUserIdMigration: Migration = {
	version: 25,
	name: 'trip_companions_user_id',
	up: (ctx) => {
		// Add a nullable user_id column so MCP owner-attributed actions
		// (e.g. `roamarr_poll_cast_vote` without a companionId) can record
		// a "self" companion per (trip, user) without name-collision
		// ambiguity. Existing companion rows backfill to NULL — they are
		// ordinary companions, not user-linked self-companions.
		//
		// The schema-level (trip_id, user_id) unique constraint is enforced
		// at insert/update time via stageUniqueGuards, which reads the
		// table.unique definition at runtime and skips rows where any
		// unique column is NULL — so ordinary companions (user_id NULL)
		// are exempt, while at most one self-companion per (trip, user)
		// is permitted. The companions_user_idx index and the unique
		// constraint are picked up from the schema on table rebuild; this
		// migration only needs to add the physical column.
		const col = tripCompanions.columns.find((c) => c.name === 'user_id');
		if (col && !ctx.db.tableColumns('trip_companions').includes('user_id')) {
			ctx.addColumn('trip_companions', col);
		}
	}
};

export const migrations = [tripCompanionsUserIdMigration];
