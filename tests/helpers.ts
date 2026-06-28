import type { Insert } from '@mongreldb/kit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	KitDatabase,
	eq as kitEq,
	and as kitAnd,
	or as kitOr,
	ne as kitNe,
	gt as kitGt,
	gte as kitGte,
	lt as kitLt,
	lte as kitLte,
	inList as kitInList,
	isNull as kitIsNull,
	isNotNull as kitIsNotNull,
	asc as kitAsc,
	desc as kitDesc,
	type TableSpec,
	type ColumnSpec,
	type Predicate
} from '@mongreldb/kit';
import {
	users,
	trips,
	segments,
	tripCompanions,
	groups,
	groupMembers,
	tripShares,
	cards,
	insurancePolicies,
	travelDocuments,
	fareProviders,
	fareWatches,
	reminders,
	notifications,
	tripExpenses,
	tripExpenseAttachments,
	schedulerRuns,
	settings,
	schema
} from '../src/lib/server/db/mongrelSchema';
import { migrations } from '../src/lib/server/db/mongrelMigrations/0001_initial';

let userCounter = 0;
let tripCounter = 0;

// Test-only shim that preserves the old `db.select(...).from(...)` typing
// while the suite is migrated to kit queries. The runtime implementation
// translates common Drizzle-style calls into equivalent kit queries so
// existing tests continue to pass without rewriting every assertion.
interface LegacySelectFrom {
	where(...conds: unknown[]): LegacySelectFrom;
	orderBy(...cols: unknown[]): LegacySelectFrom;
	limit(n: number): LegacySelectFrom;
	innerJoin(table: unknown, cond: unknown): LegacySelectFrom;
	all(): Record<string, unknown>[];
	get(): Record<string, unknown> | undefined;
}
interface LegacySelect {
	from(table: unknown): LegacySelectFrom;
}
interface LegacyInsert {
	values(vals: unknown): { returning(): { get(): Record<string, unknown> } };
}
interface LegacyUpdate {
	set(vals: unknown): {
		where(...conds: unknown[]): { returning(): { get(): Record<string, unknown> | undefined }; run(): void };
	};
}
interface LegacyDelete {
	where(...conds: unknown[]): { run(): void };
}
interface LegacyDb {
	select(fields?: unknown): LegacySelect;
	insert(table: unknown): LegacyInsert;
	update(table: unknown): LegacyUpdate;
	delete(table: unknown): LegacyDelete;
}

function allocId(): number {
	// Random high id avoids collisions when the helpers module is reloaded
	// between tests while the in-memory database persists.
	return 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
}

function toSnakeCase(key: string): string {
	return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

function toCamelCase(key: string): string {
	return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function isZeroValue(column: ColumnSpec, value: unknown): boolean {
	if (value == null) return false;
	switch (column.storageType) {
		case 'int64':
			return value === 0n || value === 0;
		case 'float64':
			return value === 0;
		case 'text':
		case 'json':
			return value === '';
		case 'bool':
			return value === false;
		case 'timestamp':
			return value === '';
		default:
			return false;
	}
}

function convertRow(row: Record<string, unknown>, kitTable: TableSpec): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		const camel = toCamelCase(k);
		const col = kitTable.columns.find((c) => c.name === k);
		if (col && col.nullable && isZeroValue(col, v)) {
			out[camel] = null;
		} else {
			out[camel] = typeof v === 'bigint' ? Number(v) : v;
		}
	}
	return out;
}

function convertValue(column: ColumnSpec, value: unknown): unknown {
	if (value == null) return null;
	if (column.storageType === 'int64' && typeof value === 'number') return BigInt(value);
	if (column.storageType === 'bool' && typeof value === 'boolean') return value;
	if (column.storageType === 'json' && typeof value !== 'string') return JSON.stringify(value);
	return value;
}

function buildKitTablesMap(): Map<string, TableSpec> {
	const map = new Map<string, TableSpec>();
	for (const t of schema.tablesList()) {
		map.set(t.name, t);
	}
	return map;
}

function resolveKitTable(table: unknown, kitTables: Map<string, TableSpec>): TableSpec | null {
	if (!table) return null;
	const spec = table as TableSpec;
	if (spec.tableId && Array.isArray(spec.columns)) return spec;
	const t = table as any;
	const name =
		t?.[Symbol.for('drizzle:Name')] ??
		t?.name ??
		t?.[Symbol.for('drizzle:BaseName')] ??
		t?.[Symbol('drizzle:Name')] ??
		undefined;
	if (typeof name === 'string') return kitTables.get(name) ?? null;
	return null;
}

function resolveKitColumn(kitTable: TableSpec, drizzleCol: unknown): ColumnSpec | null {
	const name = (drizzleCol as any)?.name;
	return name ? kitTable.columns.find((c) => c.name === name) ?? null : null;
}

function isColumnLike(obj: unknown): obj is { name: string } {
	return typeof obj === 'object' && obj !== null && 'name' in obj && typeof (obj as any).name === 'string';
}

function parseBinaryPredicate(
	kitTable: TableSpec,
	chunks: unknown[],
	start: number
): { predicate: Predicate; nextIndex: number } | null {
	if (start + 3 >= chunks.length) return null;
	const colChunk = chunks[start + 1];
	const opChunk = chunks[start + 2];
	const valChunk = chunks[start + 3];
	if (!isColumnLike(colChunk)) return null;
	const op = String((opChunk as any)?.value?.[0] ?? '').trim().toLowerCase();
	if (!op) return null;
	const kitCol = resolveKitColumn(kitTable, colChunk);
	if (!kitCol) return null;

	if (op === 'is null') return { predicate: kitIsNull(kitCol), nextIndex: start + 3 };
	if (op === 'is not null') return { predicate: kitIsNotNull(kitCol), nextIndex: start + 3 };

	let values: unknown[];
	if (Array.isArray(valChunk)) {
		values = valChunk.map((p: any) => p?.value);
	} else {
		values = [(valChunk as any)?.value];
	}

	switch (op) {
		case '=':
			return { predicate: kitEq(kitCol, convertValue(kitCol, values[0])), nextIndex: start + 4 };
		case '<>':
		case '!=':
			return { predicate: kitNe(kitCol, convertValue(kitCol, values[0])), nextIndex: start + 4 };
		case '<':
			return { predicate: kitLt(kitCol, convertValue(kitCol, values[0])), nextIndex: start + 4 };
		case '<=':
			return { predicate: kitLte(kitCol, convertValue(kitCol, values[0])), nextIndex: start + 4 };
		case '>':
			return { predicate: kitGt(kitCol, convertValue(kitCol, values[0])), nextIndex: start + 4 };
		case '>=':
			return { predicate: kitGte(kitCol, convertValue(kitCol, values[0])), nextIndex: start + 4 };
		case 'in':
			return { predicate: kitInList(kitCol, values.map((v) => convertValue(kitCol, v))), nextIndex: start + 4 };
	}
	return null;
}

function parsePredicates(
	kitTable: TableSpec,
	chunks: unknown[]
): { predicates: Predicate[]; combiner: 'and' | 'or' } | null {
	const predicates: Predicate[] = [];
	let combiner: 'and' | 'or' = 'and';
	let i = 0;
	while (i < chunks.length) {
		const chunk = chunks[i];
		if (chunk && (chunk as any).constructor?.name === 'SQL') {
			const inner = parsePredicates(kitTable, (chunk as any).queryChunks);
			if (inner && inner.predicates.length) {
				predicates.push(inner.predicates.length === 1 ? inner.predicates[0] : inner.combiner === 'or' ? kitOr(...inner.predicates) : kitAnd(...inner.predicates));
			}
			i++;
			continue;
		}
		const text = String((chunk as any)?.value?.[0] ?? '');
		if (text === ' and ' || text.toLowerCase() === ' and ') {
			combiner = 'and';
			i++;
			continue;
		}
		if (text === ' or ' || text.toLowerCase() === ' or ') {
			combiner = 'or';
			i++;
			continue;
		}
		if (text === '(' || text === ')') {
			i++;
			continue;
		}
		const parsed = parseBinaryPredicate(kitTable, chunks, i);
		if (parsed) {
			predicates.push(parsed.predicate);
			i = parsed.nextIndex;
			continue;
		}
		i++;
	}
	return { predicates, combiner };
}

function convertDrizzleCondition(kitTable: TableSpec, cond: unknown): Predicate | undefined {
	if (!cond) return undefined;
	if ((cond as any).kind) return cond as Predicate;
	const chunks = (cond as any).queryChunks;
	if (!chunks) return undefined;
	const parsed = parsePredicates(kitTable, chunks);
	if (!parsed || parsed.predicates.length === 0) return undefined;
	if (parsed.predicates.length === 1) return parsed.predicates[0];
	return parsed.combiner === 'or' ? kitOr(...parsed.predicates) : kitAnd(...parsed.predicates);
}

function convertOrderBy(kitTable: TableSpec, order: unknown): unknown {
	const chunks = (order as any)?.queryChunks;
	if (!chunks || chunks.length < 3) return undefined;
	const colChunk = chunks[1];
	if (!isColumnLike(colChunk)) return undefined;
	const kitCol = resolveKitColumn(kitTable, colChunk);
	if (!kitCol) return undefined;
	const dir = String((chunks[2] as any)?.value?.[0] ?? '').trim().toLowerCase();
	return dir === 'desc' ? kitDesc(kitCol) : kitAsc(kitCol);
}

function convertInsertValues(kitTable: TableSpec, vals: unknown): Record<string, unknown> | Record<string, unknown>[] {
	if (Array.isArray(vals)) {
		return vals.map((v) => convertInsertValues(kitTable, v) as Record<string, unknown>);
	}
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
		const snake = toSnakeCase(k);
		const col = kitTable.columns.find((c) => c.name === snake);
		out[snake] = col ? convertValue(col, v) : v;
	}
	return out;
}

function createLegacyDb(kit: KitDatabase, kitTables: Map<string, TableSpec>): LegacyDb {

	function isCountFields(fields: unknown): fields is { count: unknown } {
		return (
			typeof fields === 'object' &&
			fields !== null &&
			'count' in fields &&
			Object.keys(fields).length === 1
		);
	}

	function selectBuilder(kitTable: TableSpec, current: any, fields?: unknown) {
		let builder = current;
		const countOnly = isCountFields(fields);
		return {
			where(...conds: unknown[]) {
				for (const c of conds) {
					const p = convertDrizzleCondition(kitTable, c);
					if (p) builder = builder.where(p);
				}
				return this;
			},
			orderBy(...cols: unknown[]) {
				const orders = cols.map((c) => convertOrderBy(kitTable, c)).filter(Boolean);
				if (orders.length) builder = builder.orderBy(...orders);
				return this;
			},
			limit(n: number) {
				builder = builder.limit(n);
				return this;
			},
			innerJoin(_table: unknown, _cond: unknown) {
				throw new Error('innerJoin not supported by legacy test shim');
			},
			all() {
				if (countOnly) return [{ count: builder.executeSync().length }];
				return builder.executeSync().map((r: unknown) => convertRow(r as Record<string, unknown>, kitTable));
			},
			get() {
				if (countOnly) return { count: builder.executeSync().length };
				const rows = builder.executeSync();
				return rows[0] ? convertRow(rows[0] as Record<string, unknown>, kitTable) : undefined;
			}
		};
	}

	return {
		select(fields?: unknown) {
			return {
				from(table: unknown) {
					const kitTable = resolveKitTable(table, kitTables);
					if (!kitTable) throw new Error(`Unknown table: ${String(table)}`);
					return selectBuilder(kitTable, kit.selectFrom(kitTable), fields);
				}
			};
		},
		insert(table: unknown) {
			const kitTable = resolveKitTable(table, kitTables);
			if (!kitTable) throw new Error(`Unknown table: ${String(table)}`);
			return {
				values(vals: unknown) {
					const converted = convertInsertValues(kitTable, vals);
					return {
						returning() {
							return {
								get() {
									const inserted = Array.isArray(converted)
										? kit.insertInto(kitTable).values(converted[0] as never).executeSync()
										: kit.insertInto(kitTable).values(converted as never).executeSync();
									return convertRow(inserted as Record<string, unknown>, kitTable);
								}
							};
						},
						run() {
							if (Array.isArray(converted)) {
								for (const row of converted) {
									kit.insertInto(kitTable).values(row as never).executeSync();
								}
							} else {
								kit.insertInto(kitTable).values(converted as never).executeSync();
							}
						}
					};
				}
			};
		},
		update(table: unknown) {
			const kitTable = resolveKitTable(table, kitTables);
			if (!kitTable) throw new Error(`Unknown table: ${String(table)}`);
			return {
				set(vals: unknown) {
					const converted = convertInsertValues(kitTable, vals);
					let builder = kit.updateTable(kitTable).set(converted as never);
					const self = {
						where(...conds: unknown[]) {
							for (const c of conds) {
								const p = convertDrizzleCondition(kitTable, c);
								if (p) builder = builder.where(p as Predicate);
							}
							return self;
						},
						returning() {
							return {
								get() {
									const rows = builder.executeSync();
									return rows[0] ? convertRow(rows[0] as Record<string, unknown>, kitTable) : undefined;
								}
							};
						},
						run() {
							builder.executeSync();
						}
					};
					return self;
				}
			};
		},
		delete(table: unknown) {
			const kitTable = resolveKitTable(table, kitTables);
			if (!kitTable) throw new Error(`Unknown table: ${String(table)}`);
			let builder = kit.deleteFrom(kitTable);
			const self = {
				where(...conds: unknown[]) {
					for (const c of conds) {
						const p = convertDrizzleCondition(kitTable, c);
						if (p) builder = builder.where(p as Predicate);
					}
					return self;
				},
				run() {
					builder.executeSync();
				}
			};
			return self;
		}
	};
}

function createLegacySqlite(
	kit: KitDatabase,
	kitTables: Map<string, TableSpec>
): { exec(sql: string): void; pragma(name: string, opts?: { simple?: boolean }): unknown } {
	return {
		exec(sql: string) {
			const stmts = sql
				.split(';')
				.map((s) => s.trim())
				.filter(Boolean);
			for (const stmt of stmts) {
				const m = stmt.match(/^delete\s+from\s+["`]?([a-z_][a-z0-9_]*)["`]?$/i);
				if (m) {
					const tableName = m[1];
					const kitTable = kitTables.get(tableName);
					if (kitTable) {
						try {
							kit.deleteFrom(kitTable).executeSync();
						} catch {
							// best-effort; FK constraints may prevent deletion
						}
						continue;
					}
				}
				throw new Error(`Legacy sqlite.exec only supports "DELETE FROM table" in test shim: ${stmt}`);
			}
		},
		pragma(name: string, _opts?: { simple?: boolean }) {
			if (name === 'foreign_keys') return 1;
			return undefined;
		}
	};
}

export function freshDb() {
	const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-test-'));
	const kitInstance = KitDatabase.openSync(dir, schema);
	kitInstance.migrateSync(schema, migrations);

	// Ensure the singleton settings row exists.
	kitInstance
		.insertInto(settings)
		.values({ id: 1n } as Insert<typeof settings>)
		.executeSync();

	const close = () => {
		kitInstance.close();
		rmSync(dir, { recursive: true, force: true });
	};
	const cleanup = () => {
		try {
			close();
		} catch {
			/* best-effort cleanup */
		}
	};
	process.once('exit', cleanup);

	const kitTables = buildKitTablesMap();
	return {
		db: createLegacyDb(kitInstance, kitTables),
		sqlite: createLegacySqlite(kitInstance, kitTables),
		kit: kitInstance,
		getDb: () => kitInstance,
		dir,
		close
	};
}

export function freshKitDb() {
	return freshDb();
}

export function resetTables(kit: KitDatabase, ...tables: { tableName: string }[]) {
	for (const t of tables) {
		try {
			kit.deleteFrom(t as any).executeSync();
		} catch {
			// best-effort; some tables may not be directly deletable due to FKs
		}
	}
}

function toBigInt(id: number): bigint {
	return BigInt(id);
}

function nullableFk(id: bigint | null | undefined): number | null {
	if (id == null || id === 0n) return null;
	return Number(id);
}

function serializeJson(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

// Users

export function makeUser(kit: KitDatabase, over: Partial<Record<string, unknown>> = {}) {
	const n = userCounter++;
	const id = allocId();
	const row = kit
		.insertInto(users)
		.values({
			id: BigInt(id),
			email: (over.email as string) ?? `u${n}@x.c`,
			password_hash: (over.passwordHash as string) ?? 'x',
			display_name: (over.displayName as string) ?? `U${n}`,
			role: (over.role as any) ?? 'user',
			disabled: (over.disabled as boolean) ?? false,
			must_reset_password: (over.mustResetPassword as boolean) ?? false,
			timezone: (over.timezone as string) ?? 'UTC',
			flight_checkin_lead_hours:
				over.flightCheckinLeadHours != null ? BigInt(over.flightCheckinLeadHours as number) : undefined,
			document_expiry_lead_days:
				over.documentExpiryLeadDays != null ? BigInt(over.documentExpiryLeadDays as number) : undefined,
			email_notifications: over.emailNotifications as boolean | undefined,
			webhook_notifications: over.webhookNotifications as boolean | undefined,
			theme_id: over.themeId as string | undefined,
			default_currency: over.defaultCurrency as string | undefined,
			calendar_token: (over.calendarToken as string) ?? `cal-user-${id}`,
			calendar_token_expires_at: (over.calendarTokenExpiresAt as string | null) ?? null
		} as any)
		.executeSync();
	return {
		id,
		email: row.email,
		passwordHash: row.password_hash,
		displayName: row.display_name,
		role: row.role,
		disabled: row.disabled,
		mustResetPassword: row.must_reset_password,
		timezone: row.timezone,
		flightCheckinLeadHours: Number(row.flight_checkin_lead_hours),
		documentExpiryLeadDays: Number(row.document_expiry_lead_days),
		emailNotifications: row.email_notifications,
		webhookNotifications: row.webhook_notifications,
		themeId: row.theme_id,
		defaultCurrency: row.default_currency,
		calendarToken: row.calendar_token,
		calendarTokenExpiresAt: row.calendar_token_expires_at,
		createdAt: row.created_at
	};
}

export function makeAdmin(kit: KitDatabase, over: Partial<Record<string, unknown>> = {}) {
	return makeUser(kit, { ...over, role: 'admin' });
}

// Trips

export function makeTrip(
	kit: KitDatabase,
	ownerId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const n = tripCounter++;
	const id = allocId();
	const row = kit
		.insertInto(trips)
		.values({
			id: BigInt(id),
			owner_id: BigInt(ownerId),
			name: (over.name as string) ?? `Test Trip ${n}`,
			destination: (over.destination as string | null) ?? null,
			destination_country_code: (over.destinationCountryCode as string | null) ?? null,
			destination_city_name: (over.destinationCityName as string | null) ?? null,
			destination_city_lat: (over.destinationCityLat as number | null) ?? null,
			destination_city_lng: (over.destinationCityLng as number | null) ?? null,
			start_date: (over.startDate as string | null) ?? null,
			end_date: (over.endDate as string | null) ?? null,
			notes: (over.notes as string | null) ?? null,
			tags: (over.tags as string) ?? '[]',
			archived: (over.archived as boolean) ?? false,
			favorite: (over.favorite as boolean) ?? false,
			default_visibility: (over.defaultVisibility as any) ?? 'private',
			public_token: (over.publicToken as string) ?? `pub-trip-${id}`,
			public_token_expires_at: (over.publicTokenExpiresAt as string | null) ?? null,
			public_show_details: (over.publicShowDetails as boolean) ?? false,
			calendar_token: (over.calendarToken as string) ?? `cal-trip-${id}`,
			calendar_token_expires_at: (over.calendarTokenExpiresAt as string | null) ?? null,
			base_currency: (over.baseCurrency as string) ?? 'USD',
			status: (over.status as any) ?? 'booked'
		} as any)
		.executeSync();
	return {
		id,
		ownerId,
		name: row.name,
		destination: row.destination,
		destinationCountryCode: row.destination_country_code,
		destinationCityName: row.destination_city_name,
		destinationCityLat: row.destination_city_lat,
		destinationCityLng: row.destination_city_lng,
		startDate: row.start_date,
		endDate: row.end_date,
		notes: row.notes,
		tags: row.tags,
		archived: row.archived,
		favorite: row.favorite,
		defaultVisibility: row.default_visibility,
		publicToken: row.public_token,
		publicTokenExpiresAt: row.public_token_expires_at,
		publicShowDetails: row.public_show_details,
		calendarToken: row.calendar_token,
		calendarTokenExpiresAt: row.calendar_token_expires_at,
		baseCurrency: row.base_currency,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

// Segments

export function makeSegment(
	kit: KitDatabase,
	tripId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit
		.insertInto(segments)
		.values({
			id: BigInt(id),
			trip_id: BigInt(tripId),
			type: (over.type as any) ?? 'flight',
			title: (over.title as string) ?? 'Segment',
			start_at: (over.startAt as string) ?? new Date().toISOString(),
			start_tz: (over.startTz as any) ?? 'UTC',
			end_at: (over.endAt as string | null) ?? null,
			end_tz: (over.endTz as string | null) ?? null,
			status: (over.status as any) ?? 'planned',
			location: (over.location as string | null) ?? null,
			country_code: (over.countryCode as string | null) ?? null,
			city_name: (over.cityName as string | null) ?? null,
			city_lat: (over.cityLat as number | null) ?? null,
			city_lng: (over.cityLng as number | null) ?? null,
			venue: (over.venue as string | null) ?? null,
			confirmation_number: (over.confirmationNumber as string | null) ?? null,
			details_json: serializeJson(over.detailsJson) as any,
			meeting_point: (over.meetingPoint as string | null) ?? null,
			meeting_at: (over.meetingAt as string | null) ?? null,
			payment_status: (over.paymentStatus as any) ?? 'quoted',
			payment_due_date: (over.paymentDueDate as string | null) ?? null,
			card_id: over.cardId ? BigInt(over.cardId as number) : null
		} as any)
		.executeSync();
	return {
		id,
		tripId,
		type: row.type,
		title: row.title,
		startAt: row.start_at,
		startTz: row.start_tz,
		endAt: row.end_at,
		endTz: row.end_tz,
		status: row.status,
		location: row.location,
		countryCode: row.country_code,
		cityName: row.city_name,
		cityLat: row.city_lat,
		cityLng: row.city_lng,
		venue: row.venue,
		confirmationNumber: row.confirmation_number,
		detailsJson: serializeJson(row.details_json),
		meetingPoint: row.meeting_point,
		meetingAt: row.meeting_at,
		paymentStatus: row.payment_status,
		paymentDueDate: row.payment_due_date,
		cardId: nullableFk(row.card_id),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

// Companions

export function makeCompanion(
	kit: KitDatabase,
	tripId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit
		.insertInto(tripCompanions)
		.values({
			id: BigInt(id),
			trip_id: BigInt(tripId),
			name: (over.name as string) ?? 'Companion',
			category: (over.category as any) ?? 'adult',
			dietary: (over.dietary as string | null) ?? null,
			allergies: (over.allergies as string | null) ?? null,
			medical_notes: (over.medicalNotes as string | null) ?? null,
			needs_car_seat: (over.needsCarSeat as boolean) ?? false,
			needs_stroller: (over.needsStroller as boolean) ?? false,
			needs_crib: (over.needsCrib as boolean) ?? false,
			needs_kids_meal: (over.needsKidsMeal as boolean) ?? false,
			child_ticket_discount: (over.childTicketDiscount as string | null) ?? null,
			seat_preference: (over.seatPreference as any) ?? null,
			bed_preference: (over.bedPreference as any) ?? null,
			accessibility_needs: (over.accessibilityNeeds as string | null) ?? null,
			room_notes: (over.roomNotes as string | null) ?? null,
			notes: (over.notes as string | null) ?? null
		} as any)
		.executeSync();
	return {
		id,
		tripId,
		name: row.name,
		category: row.category,
		notes: row.notes,
		dietary: row.dietary,
		allergies: row.allergies,
		medicalNotes: row.medical_notes,
		needsCarSeat: row.needs_car_seat,
		needsStroller: row.needs_stroller,
		needsCrib: row.needs_crib,
		needsKidsMeal: row.needs_kids_meal,
		childTicketDiscount: row.child_ticket_discount,
		seatPreference: row.seat_preference,
		bedPreference: row.bed_preference,
		accessibilityNeeds: row.accessibility_needs,
		roomNotes: row.room_notes,
		createdAt: row.created_at
	};
}

// Groups and members

export function makeGroup(kit: KitDatabase, ownerId: number, name: string) {
	const id = allocId();
	const row = kit
		.insertInto(groups)
		.values({ id: BigInt(id), owner_id: BigInt(ownerId), name: name.trim() } as any)
		.executeSync();
	return {
		id,
		ownerId,
		name: row.name,
		createdAt: row.created_at
	};
}

export function makeGroupMember(kit: KitDatabase, groupId: number, userId: number) {
	kit.insertInto(groupMembers).values({
		group_id: BigInt(groupId),
		user_id: BigInt(userId)
	} as any).executeSync();
	return { groupId, userId };
}

// Shares

export function makeShare(
	kit: KitDatabase,
	input: {
		tripId: number;
		sharedWithUserId?: number | null;
		sharedWithGroupId?: number | null;
		permission?: 'read' | 'edit';
		showDetails?: boolean;
	}
) {
	const id = allocId();
	const sharedWithUserId = input.sharedWithUserId ?? null;
	const sharedWithGroupId = input.sharedWithGroupId ?? null;
	const row = kit.insertInto(tripShares).values({
		id: BigInt(id),
		trip_id: BigInt(input.tripId),
		shared_with_user_id: sharedWithUserId != null ? BigInt(sharedWithUserId) : null,
		shared_with_group_id: sharedWithGroupId != null ? BigInt(sharedWithGroupId) : null,
		permission: input.permission ?? 'read',
		show_details: input.showDetails ?? false
	} as any).executeSync();
	return {
		id,
		tripId: input.tripId,
		sharedWithUserId,
		sharedWithGroupId,
		permission: row.permission,
		showDetails: row.show_details,
		createdAt: row.created_at
	};
}

// Cards

export function makeCard(
	kit: KitDatabase,
	userId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(cards).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		nickname: (over.nickname as string) ?? 'Card',
		network: (over.network as any) ?? 'visa',
		last4: (over.last4 as string | null) ?? null,
		notes: (over.notes as string | null) ?? null
	} as any).executeSync();
	return {
		id,
		userId,
		nickname: row.nickname,
		network: row.network,
		last4: row.last4,
		notes: row.notes
	};
}

// Insurance policies

export function makeInsurancePolicy(
	kit: KitDatabase,
	userId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(insurancePolicies).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		provider: (over.provider as string) ?? 'Provider',
		policy_number: (over.policyNumber as string | null) ?? null,
		coverage_summary: (over.coverageSummary as string | null) ?? null,
		coverage_amount: over.coverageAmount != null ? BigInt(over.coverageAmount as number) : null,
		currency: (over.currency as string) ?? 'USD',
		start_date: (over.startDate as string | null) ?? null,
		end_date: (over.endDate as string | null) ?? null,
		trip_id: over.tripId ? BigInt(over.tripId as number) : null,
		notes: (over.notes as string | null) ?? null
	} as any).executeSync();
	return {
		id,
		userId,
		provider: row.provider,
		policyNumber: row.policy_number,
		coverageSummary: row.coverage_summary,
		coverageAmount: nullableFk(row.coverage_amount),
		currency: row.currency,
		startDate: row.start_date,
		endDate: row.end_date,
		tripId: nullableFk(row.trip_id),
		notes: row.notes
	};
}

// Travel documents

export function makeTravelDocument(
	kit: KitDatabase,
	userId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(travelDocuments).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		companion_id: over.companionId ? BigInt(over.companionId as number) : null,
		type: (over.type as any) ?? 'passport',
		number: (over.number as string | null) ?? null,
		issuing_authority: (over.issuingAuthority as string | null) ?? null,
		expires_on: (over.expiresOn as string | null) ?? null,
		notes: (over.notes as string | null) ?? null
	} as any).executeSync();
	return {
		id,
		userId,
		companionId: nullableFk(row.companion_id),
		type: row.type,
		number: row.number,
		issuingAuthority: row.issuing_authority,
		expiresOn: row.expires_on,
		notes: row.notes
	};
}

// Fare providers and watches

export function makeFareProvider(
	kit: KitDatabase,
	userId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(fareProviders).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		provider_key: (over.providerKey as string) ?? 'stub',
		label: (over.label as string) ?? '',
		api_key: (over.apiKey as string | null) ?? null,
		enabled: (over.enabled as boolean) ?? true
	} as any).executeSync();
	return {
		id,
		userId,
		providerKey: row.provider_key,
		label: row.label,
		apiKey: row.api_key,
		enabled: row.enabled
	};
}

export function makeFareWatch(
	kit: KitDatabase,
	input: {
		tripId: number;
		providerId: number;
		segmentId?: number | null;
		status?: 'active' | 'paused';
	}
) {
	const id = allocId();
	const row = kit.insertInto(fareWatches).values({
		id: BigInt(id),
		trip_id: BigInt(input.tripId),
		provider_id: BigInt(input.providerId),
		segment_id: input.segmentId != null ? BigInt(input.segmentId) : null,
		status: input.status ?? 'active'
	} as any).executeSync();
	return {
		id,
		tripId: input.tripId,
		providerId: input.providerId,
		segmentId: input.segmentId ?? null,
		status: row.status,
		lastCheckedAt: null,
		lastResultJson: null,
		createdAt: row.created_at
	};
}

// Notifications and reminders

export function makeNotification(
	kit: KitDatabase,
	userId: number,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(notifications).values({
		id: BigInt(id),
		user_id: BigInt(userId),
		title: (over.title as string) ?? 'Notification',
		body: (over.body as string) ?? 'Body',
		link: (over.link as string | null) ?? null
	} as any).executeSync();
	return {
		id,
		userId,
		title: row.title,
		body: row.body,
		link: row.link,
		createdAt: row.created_at,
		readAt: row.read_at
	};
}

export function makeReminder(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(reminders).values({
		id: BigInt(id),
		user_id: BigInt((over.userId as number) ?? 0),
		kind: (over.kind as any) ?? 'custom',
		ref_type: (over.refType as any) ?? 'trip',
		ref_id: BigInt((over.refId as number) ?? 0),
		fire_at: (over.fireAt as string) ?? new Date().toISOString(),
		status: (over.status as any) ?? 'pending',
		attempts: BigInt((over.attempts as number) ?? 0),
		sent_at: (over.sentAt as string | null) ?? null
	} as any).executeSync();
	return {
		id,
		userId: Number(row.user_id),
		kind: row.kind,
		refType: row.ref_type,
		refId: Number(row.ref_id),
		fireAt: row.fire_at,
		status: row.status,
		attempts: Number(row.attempts),
		sentAt: row.sent_at,
		createdAt: row.created_at
	};
}

// Expenses and attachments

export function makeExpense(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(tripExpenses).values({
		id: BigInt(id),
		trip_id: BigInt((over.tripId as number) ?? 0),
		description: (over.description as string) ?? 'Expense',
		amount: BigInt((over.amount as number) ?? 0),
		currency: (over.currency as string) ?? 'USD',
		category: (over.category as any) ?? null,
		exchange_rate: BigInt((over.exchangeRate as number) ?? 10000),
		base_amount: BigInt((over.baseAmount as number) ?? 0),
		paid_by_companion_id: over.paidByCompanionId ? BigInt(over.paidByCompanionId as number) : null,
		split_among: serializeJson(over.splitAmong) ?? '[]'
	} as any).executeSync();
	return {
		id,
		tripId: Number(row.trip_id),
		description: row.description,
		amount: Number(row.amount),
		currency: row.currency,
		category: row.category,
		exchangeRate: Number(row.exchange_rate),
		baseAmount: Number(row.base_amount),
		paidByCompanionId: nullableFk(row.paid_by_companion_id),
		splitAmong: serializeJson(row.split_among),
		createdAt: row.created_at
	};
}

export function makeAttachment(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const row = kit.insertInto(tripExpenseAttachments).values({
		id: BigInt(id),
		expense_id: BigInt((over.expenseId as number) ?? 0),
		filename: (over.filename as string) ?? 'file.png',
		storage_key: (over.storageKey as string) ?? 'key',
		content_type: (over.contentType as string) ?? 'image/png',
		size_bytes: BigInt((over.sizeBytes as number) ?? 0)
	} as any).executeSync();
	return {
		id,
		expenseId: Number(row.expense_id),
		filename: row.filename,
		storageKey: row.storage_key,
		contentType: row.content_type,
		sizeBytes: Number(row.size_bytes),
		createdAt: row.created_at
	};
}

// Scheduler runs

export function makeSchedulerRun(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	const id = allocId();
	const now = new Date().toISOString();
	const row = kit.insertInto(schedulerRuns).values({
		id: BigInt(id),
		started_at: (over.startedAt as string) ?? now,
		finished_at: (over.finishedAt as string | null) ?? null,
		success: (over.success as boolean) ?? false,
		error_message: (over.errorMessage as string | null) ?? null
	} as any).executeSync();
	return {
		id,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		success: row.success,
		errorMessage: row.error_message
	};
}

// Backwards-compatible wrappers used by older tests. They keep the old name
// while delegating to the canonical kit-only helpers above.

export function makeSyncedUser(kit: KitDatabase, over: Partial<Record<string, unknown>> = {}) {
	return makeUser(kit, over);
}

export function makeSyncedTrip(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	return makeTrip(kit, (over.ownerId as number) ?? 0, over);
}

export function makeSyncedCompanion(
	kit: KitDatabase,
	over: Partial<Record<string, unknown>> = {}
) {
	return makeCompanion(kit, (over.tripId as number) ?? 0, over);
}
