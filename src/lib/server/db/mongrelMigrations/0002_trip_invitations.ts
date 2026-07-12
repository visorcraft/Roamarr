import type { Migration } from '@visorcraft/mongreldb-kit';
import { tripCompanions, tripInvitations } from '../mongrelSchema';

const categoryColumn = tripCompanions.columns.find((column) => column.name === 'category')!;

export const tripInvitationsMigration: Migration = {
	version: 2,
	name: 'trip_invitations',
	ops: [
		{ kind: 'createTable', name: 'trip_invitations' },
		{ kind: 'alterColumn', table: 'trip_companions', column: 'category' }
	],
	up: (ctx) => {
		ctx.ensureTable(tripInvitations);
		ctx.alterColumn('trip_companions', 'category', categoryColumn);
	}
};
