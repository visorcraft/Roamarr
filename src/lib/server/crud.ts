import { eq, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteTable, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from './db';
import { logAudit } from './audit';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';

type TripOwnedTable = SQLiteTable & {
	id: AnySQLiteColumn;
	tripId: AnySQLiteColumn;
	createdAt: AnySQLiteColumn;
};

export interface TripCrudOptions<TTable extends TripOwnedTable, Input> {
	table: TTable;
	auditEntity: string;
	orderBy?: SQL | SQL[];
	validate(input: Input): void;
	buildInsert(input: Input, tripId: number): TTable['$inferInsert'];
}

export function tripCrudFactory<TTable extends TripOwnedTable, Input>(options: TripCrudOptions<TTable, Input>) {
	const { table, auditEntity, orderBy = desc(table.createdAt), validate, buildInsert } = options;

	function list(tripId: number): TTable['$inferSelect'][] {
		return db.select().from(table).where(eq(table.tripId, tripId)).orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy])).all();
	}

	function add(userId: number, tripId: number, input: Input): TTable['$inferSelect'] {
		requireEditableTrip(userId, tripId);
		validate(input);
		const inserted = db.insert(table).values(buildInsert(input, tripId) as TTable['$inferInsert']).returning().get() as TTable['$inferSelect'];
		logAudit(userId, 'create', auditEntity, inserted.id, { tripId });
		return inserted;
	}

	function remove(userId: number, tripId: number, id: number): void {
		requireEditableTrip(userId, tripId);
		requireOwnedTripRow(table, tripId, id, 'Not found');
		db.delete(table).where(eq(table.id, id)).run();
		logAudit(userId, 'delete', auditEntity, id, { tripId });
	}

	return { list, add, remove };
}
