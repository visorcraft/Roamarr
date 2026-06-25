import { eq, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteTable, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from './db';
import { logAudit } from './audit';
import { requireEditableTrip, requireOwnedTripRow, requireOwnedUserRow } from './ownership';

type TripOwnedTable = SQLiteTable & {
	id: AnySQLiteColumn;
	tripId: AnySQLiteColumn;
	createdAt: AnySQLiteColumn;
};

export interface TripCrudOptions<
	TTable extends TripOwnedTable,
	Input,
	UpdateInput = never,
	ListRow = TTable['$inferSelect']
> {
	table: TTable;
	auditEntity: string;
	orderBy?: SQL | SQL[];
	validate(input: Input): void;
	buildInsert(input: Input, tripId: number): TTable['$inferInsert'];
	list?: (tripId: number) => ListRow[];
	update?: {
		validate(input: UpdateInput): void;
		buildSet(input: UpdateInput): Partial<TTable['$inferInsert']>;
		action?: string;
	};
}

export function tripCrudFactory<
	TTable extends TripOwnedTable,
	Input,
	UpdateInput = never,
	ListRow = TTable['$inferSelect']
>(options: TripCrudOptions<TTable, Input, UpdateInput, ListRow>) {
	const {
		table,
		auditEntity,
		orderBy = desc(table.createdAt),
		validate,
		buildInsert,
		list: customList,
		update: updateOptions
	} = options;

	function list(tripId: number): ListRow[] {
		if (customList) return customList(tripId);
		return db
			.select()
			.from(table)
			.where(eq(table.tripId, tripId))
			.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]))
			.all() as ListRow[];
	}

	function add(userId: number, tripId: number, input: Input): TTable['$inferSelect'] {
		requireEditableTrip(userId, tripId);
		validate(input);
		const inserted = db
			.insert(table)
			.values(buildInsert(input, tripId) as TTable['$inferInsert'])
			.returning()
			.get() as TTable['$inferSelect'];
		logAudit(userId, 'create', auditEntity, inserted.id, { tripId });
		return inserted;
	}

	function modify(userId: number, tripId: number, id: number, input: UpdateInput): TTable['$inferSelect'] {
		if (!updateOptions) throw new Error('Update not supported for this CRUD factory');
		requireEditableTrip(userId, tripId);
		updateOptions.validate(input);
		requireOwnedTripRow(table, tripId, id, 'Not found');
		const updated = db
			.update(table)
			.set(updateOptions.buildSet(input) as TTable['$inferInsert'])
			.where(eq(table.id, id))
			.returning()
			.get() as TTable['$inferSelect'];
		logAudit(userId, updateOptions.action ?? 'update', auditEntity, id, { tripId });
		return updated;
	}

	function remove(userId: number, tripId: number, id: number): void {
		requireEditableTrip(userId, tripId);
		requireOwnedTripRow(table, tripId, id, 'Not found');
		db.delete(table).where(eq(table.id, id)).run();
		logAudit(userId, 'delete', auditEntity, id, { tripId });
	}

	return { list, add, modify, remove };
}

type UserOwnedTable = SQLiteTable & {
	id: AnySQLiteColumn;
	userId: AnySQLiteColumn;
	createdAt?: AnySQLiteColumn;
};

export interface UserCrudOptions<
	TTable extends UserOwnedTable,
	Input,
	UpdateInput = never,
	ListRow = TTable['$inferSelect']
> {
	table: TTable;
	auditEntity: string;
	orderBy: SQL | SQL[];
	validate(input: Input): void;
	buildInsert(input: Input, userId: number): TTable['$inferInsert'];
	list?: (userId: number) => ListRow[];
	update?: {
		validate(input: UpdateInput): void;
		buildSet(input: UpdateInput): Partial<TTable['$inferInsert']>;
		action?: string;
	};
}

export function userCrudFactory<
	TTable extends UserOwnedTable,
	Input,
	UpdateInput = never,
	ListRow = TTable['$inferSelect']
>(options: UserCrudOptions<TTable, Input, UpdateInput, ListRow>) {
	const {
		table,
		auditEntity,
		orderBy,
		validate,
		buildInsert,
		list: customList,
		update: updateOptions
	} = options;

	function list(userId: number): ListRow[] {
		if (customList) return customList(userId);
		return db
			.select()
			.from(table)
			.where(eq(table.userId, userId))
			.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]))
			.all() as ListRow[];
	}

	function add(userId: number, input: Input): TTable['$inferSelect'] {
		validate(input);
		const inserted = db
			.insert(table)
			.values(buildInsert(input, userId) as TTable['$inferInsert'])
			.returning()
			.get() as TTable['$inferSelect'];
		logAudit(userId, 'create', auditEntity, inserted.id);
		return inserted;
	}

	function modify(userId: number, id: number, input: UpdateInput): TTable['$inferSelect'] {
		if (!updateOptions) throw new Error('Update not supported for this CRUD factory');
		updateOptions.validate(input);
		requireOwnedUserRow(table, userId, id, 'Not found');
		const updated = db
			.update(table)
			.set(updateOptions.buildSet(input) as TTable['$inferInsert'])
			.where(eq(table.id, id))
			.returning()
			.get() as TTable['$inferSelect'];
		logAudit(userId, updateOptions.action ?? 'update', auditEntity, id);
		return updated;
	}

	function remove(userId: number, id: number): void {
		requireOwnedUserRow(table, userId, id, 'Not found');
		db.delete(table).where(eq(table.id, id)).run();
		logAudit(userId, 'delete', auditEntity, id);
	}

	return { list, add, modify, remove };
}
