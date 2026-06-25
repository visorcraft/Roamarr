import { createDb } from '../src/lib/server/db/createDb';
import { applyMigrations } from '../src/lib/server/db/migrate';
import { settings, users, trips, segments, tripCompanions } from '../src/lib/server/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

let userCounter = 0;
let tripCounter = 0;

export function freshDb() {
	const { db, sqlite } = createDb(':memory:');
	applyMigrations(db);
	db.insert(settings).values({ id: 1 }).run();
	return { db, sqlite };
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
			visibility: (over.visibility as 'private' | 'group' | 'public') ?? 'private',
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
