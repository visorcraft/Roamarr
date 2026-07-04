import { eq as kitEq, asc, desc, type OrderBy, type TableSpec, type Row, type Insert } from '@visorcraft/mongreldb-kit';
import { kit } from './db';
import { logAudit } from './audit';
import { requireEditableTrip, requireOwnedTripRow } from './ownership';

type KitTableWithTrip = TableSpec & { id: unknown; trip_id: unknown };

interface TripCrudOptions<
	TTable extends KitTableWithTrip,
	Input,
	UpdateInput = never,
	ListRow = Row<TTable>
> {
	table: TTable;
	auditEntity: string;
	orderBy?: OrderBy | OrderBy[];
	validate(input: Input): void;
	buildInsert(input: Input, tripId: number): Insert<TTable>;
	list?: (tripId: number) => ListRow[];
	update?: {
		validate(input: UpdateInput): void;
		buildSet(input: UpdateInput): Partial<Row<TTable>>;
		action?: string;
	};
}

export function tripCrudFactory<
	TTable extends KitTableWithTrip,
	Input,
	UpdateInput = never,
	ListRow = Row<TTable>
>(options: TripCrudOptions<TTable, Input, UpdateInput, ListRow>) {
	const {
		table,
		auditEntity,
		orderBy = desc(table.id as any),
		validate,
		buildInsert,
		list: customList,
		update: updateOptions
	} = options;

	function list(tripId: number): ListRow[] {
		if (customList) return customList(tripId);
		const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
		return kit
			.selectFrom(table)
			.where(kitEq(table.trip_id as any, BigInt(tripId)))
			.orderBy(...orders)
			.executeSync() as ListRow[];
	}

	function add(userId: number, tripId: number, input: Input): Row<TTable> {
		requireEditableTrip(userId, tripId);
		validate(input);
		const inserted = kit
			.insertInto(table)
			.values(buildInsert(input, tripId) as Insert<TTable>)
			.executeSync();
		logAudit(userId, 'create', auditEntity, Number((inserted as Record<string, unknown>).id), { tripId });
		return inserted as Row<TTable>;
	}

	function modify(userId: number, tripId: number, id: number, input: UpdateInput): Row<TTable> {
		if (!updateOptions) throw new Error('Update not supported for this CRUD factory');
		requireEditableTrip(userId, tripId);
		updateOptions.validate(input);
		requireOwnedTripRow(table, tripId, id, 'Not found');
		const updated = kit
			.updateTable(table)
			.set(updateOptions.buildSet(input) as Partial<Row<TTable>>)
			.where(kitEq(table.id as any, BigInt(id)))
			.executeSync();
		const row = updated[0];
		if (!row) throw new Error('Update failed');
		logAudit(userId, updateOptions.action ?? 'update', auditEntity, id, { tripId });
		return row as Row<TTable>;
	}

	function remove(userId: number, tripId: number, id: number): void {
		requireEditableTrip(userId, tripId);
		requireOwnedTripRow(table, tripId, id, 'Not found');
		kit.deleteFrom(table).where(kitEq(table.id as any, BigInt(id))).executeSync();
		logAudit(userId, 'delete', auditEntity, id, { tripId });
	}

	return { list, add, modify, remove };
}

