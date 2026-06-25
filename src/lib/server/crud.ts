import { eq, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from './db';
import { logAudit } from './audit';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';

export interface TripCrudOptions<TTable extends SQLiteTable, Input> {
	table: TTable;
	auditEntity: string;
	orderBy?: SQL | SQL[];
	validate(input: Input): void;
	buildInsert(input: Input, tripId: number): TTable['$inferInsert'];
}

export function tripCrudFactory<TTable extends SQLiteTable, Input>(options: TripCrudOptions<TTable, Input>) {
	const { table, auditEntity, orderBy = desc(table.createdAt as any), validate, buildInsert } = options;

	function list(tripId: number): TTable['$inferSelect'][] {
		return db.select().from(table).where(eq(table.tripId as any, tripId)).orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy])).all();
	}

	function add(userId: number, tripId: number, input: Input): TTable['$inferSelect'] {
		requireEditableTrip(userId, tripId);
		validate(input);
		const inserted = db.insert(table).values(buildInsert(input, tripId) as any).returning().get();
		logAudit(userId, 'create', auditEntity, inserted.id, { tripId });
		return inserted;
	}

	function remove(userId: number, tripId: number, id: number): void {
		requireEditableTrip(userId, tripId);
		requireOwnedTripRow(table, tripId, id, 'Not found');
		db.delete(table).where(eq(table.id as any, id)).run();
		logAudit(userId, 'delete', auditEntity, id, { tripId });
	}

	return { list, add, remove };
}
