import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../src/lib/server/db/createDb';
import { applyMigrations } from '../src/lib/server/db/migrate';
import { settings, users, trips, segments, tripCompanions } from '../src/lib/server/db/schema';
import {
	users as kitUsers,
	trips as kitTrips,
	tripCompanions as kitTripCompanions
} from '../src/lib/server/db/mongrelSchema';
import { KitDatabase } from '@mongreldb/kit';
import { schema as kitSchema } from '../src/lib/server/db/mongrelSchema';
import { migrations as kitMigrations } from '../src/lib/server/db/mongrelMigrations/0001_initial';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database } from 'better-sqlite3';

let userCounter = 0;
let tripCounter = 0;

export function freshDb() {
	const { db, sqlite } = createDb(':memory:');
	applyMigrations(db);
	db.insert(settings).values({ id: 1 }).run();

	// Also provide a fresh MongrelDB Kit instance for code that has migrated to
	// the kit singleton. The temp directory is removed on process exit.
	const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-test-'));
	const kit = KitDatabase.openSync(dir, kitSchema);
	kit.migrateSync(kitSchema, kitMigrations);

	const close = () => {
		kit.close();
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

	return { db, sqlite, kit, getDb: () => kit, close };
}

export function freshKitDb() {
	const dir = mkdtempSync(join(tmpdir(), 'roamarr-kit-test-'));
	const kit = KitDatabase.openSync(dir, kitSchema);
	kit.migrateSync(kitSchema, kitMigrations);
	return {
		kit,
		close: () => {
			kit.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

export function resetTables(sqlite: Database, ...tables: string[]) {
	sqlite.exec(tables.map((t) => `delete from ${t};`).join(' '));
}

export function makeUser(
	db: BetterSQLite3Database<Record<string, unknown>>,
	over: Partial<typeof users.$inferInsert> = {}
) {
	const n = userCounter++;
	return db
		.insert(users)
		.values({
			email: over.email ?? `u${n}@x.c`,
			passwordHash: over.passwordHash ?? 'x',
			displayName: over.displayName ?? `U${n}`,
			role: over.role ?? 'user',
			disabled: over.disabled ?? false,
			timezone: over.timezone ?? 'UTC',
			flightCheckinLeadHours: over.flightCheckinLeadHours ?? 24,
			documentExpiryLeadDays: over.documentExpiryLeadDays ?? 90,
			defaultCurrency: over.defaultCurrency ?? 'USD',
			themeId: over.themeId ?? 'midnight-travels'
		})
		.returning()
		.get();
}

export function makeTrip(
	db: BetterSQLite3Database<Record<string, unknown>>,
	over: Partial<typeof trips.$inferInsert> = {}
) {
	const n = tripCounter++;
	return db
		.insert(trips)
		.values({
			ownerId: over.ownerId ?? 0,
			name: over.name ?? `Test Trip ${n}`,
			defaultVisibility:
				(over.defaultVisibility as 'private' | 'groups' | 'public') ?? 'private',
			...over
		})
		.returning()
		.get();
}

export function makeSegment(
	db: BetterSQLite3Database<Record<string, unknown>>,
	over: Partial<typeof segments.$inferInsert> = {}
) {
	return db
		.insert(segments)
		.values({
			tripId: over.tripId ?? 0,
			type: (over.type as typeof segments.$inferSelect.type) ?? 'flight',
			title: over.title ?? 'Segment',
			status: (over.status as typeof segments.$inferSelect.status) ?? 'planned',
			startAt: over.startAt ?? new Date().toISOString(),
			...over
		})
		.returning()
		.get();
}

export function makeCompanion(
	db: BetterSQLite3Database<Record<string, unknown>>,
	over: Partial<typeof tripCompanions.$inferInsert> = {}
) {
	return db
		.insert(tripCompanions)
		.values({
			tripId: over.tripId ?? 0,
			name: over.name ?? 'Companion',
			...over
		})
		.returning()
		.get();
}

// During the MongrelDB Kit migration, code under test may write to the kit
// database while fixtures are still created via Drizzle. These helpers keep the
// two stores in sync for the tables that migrated code references.

export function makeSyncedUser(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof users.$inferInsert> = {}
) {
	const n = userCounter++;
	const row = db
		.insert(users)
		.values({
			email: over.email ?? `u${n}@x.c`,
			passwordHash: over.passwordHash ?? 'x',
			displayName: over.displayName ?? `U${n}`,
			role: over.role ?? 'user',
			disabled: over.disabled ?? false,
			mustResetPassword: over.mustResetPassword ?? false,
			timezone: over.timezone ?? 'UTC',
			flightCheckinLeadHours: over.flightCheckinLeadHours ?? 24,
			documentExpiryLeadDays: over.documentExpiryLeadDays ?? 90,
			defaultCurrency: over.defaultCurrency ?? 'USD',
			themeId: over.themeId ?? 'midnight-travels'
		})
		.returning()
		.get();
	kit.insertInto(kitUsers).values({
		id: BigInt(row.id),
		email: row.email,
		password_hash: row.passwordHash,
		display_name: row.displayName,
		role: row.role,
		disabled: row.disabled,
		must_reset_password: row.mustResetPassword,
		timezone: row.timezone,
		flight_checkin_lead_hours: BigInt(row.flightCheckinLeadHours),
		document_expiry_lead_days: BigInt(row.documentExpiryLeadDays),
		email_notifications: row.emailNotifications,
		webhook_notifications: row.webhookNotifications,
		theme_id: row.themeId,
		default_currency: row.defaultCurrency,
		calendar_token: row.calendarToken ?? null,
		calendar_token_expires_at: row.calendarTokenExpiresAt ?? null
	} as never).executeSync();
	return row;
}

export function makeSyncedTrip(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof trips.$inferInsert> = {}
) {
	const n = tripCounter++;
	const row = db
		.insert(trips)
		.values({
			ownerId: over.ownerId ?? 0,
			name: over.name ?? `Test Trip ${n}`,
			defaultVisibility:
				(over.defaultVisibility as 'private' | 'groups' | 'public') ?? 'private',
			...over
		})
		.returning()
		.get();
	kit.insertInto(kitTrips).values({
		id: BigInt(row.id),
		owner_id: BigInt(row.ownerId),
		name: row.name,
		destination: row.destination ?? null,
		destination_country_code: row.destinationCountryCode ?? null,
		destination_city_name: row.destinationCityName ?? null,
		destination_city_lat: row.destinationCityLat ?? null,
		destination_city_lng: row.destinationCityLng ?? null,
		start_date: row.startDate ?? null,
		end_date: row.endDate ?? null,
		notes: row.notes ?? null,
		tags: row.tags ?? '[]',
		archived: row.archived ?? false,
		favorite: row.favorite ?? false,
		default_visibility: row.defaultVisibility ?? 'private',
		public_token: row.publicToken ?? null,
		public_token_expires_at: row.publicTokenExpiresAt ?? null,
		public_show_details: row.publicShowDetails ?? false,
		calendar_token: row.calendarToken ?? null,
		calendar_token_expires_at: row.calendarTokenExpiresAt ?? null,
		base_currency: row.baseCurrency ?? 'USD',
		status: (row.status as 'planning' | 'booked' | 'active' | 'completed') ?? 'booked'
	} as never).executeSync();
	return row;
}

export function makeSyncedCompanion(
	db: BetterSQLite3Database<Record<string, unknown>>,
	kit: KitDatabase,
	over: Partial<typeof tripCompanions.$inferInsert> = {}
) {
	const row = db
		.insert(tripCompanions)
		.values({
			tripId: over.tripId ?? 0,
			name: over.name ?? 'Companion',
			category: (over.category as 'adult' | 'child' | 'other') ?? 'adult',
			...over
		})
		.returning()
		.get();
	kit.insertInto(kitTripCompanions).values({
		id: BigInt(row.id),
		trip_id: BigInt(row.tripId),
		name: row.name,
		category: row.category ?? 'adult'
	} as never).executeSync();
	return row;
}
