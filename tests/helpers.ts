import { createDb } from '../src/lib/server/db/createDb';
import { applyMigrations } from '../src/lib/server/db/migrate';
import { settings, users } from '../src/lib/server/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

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
	return db
		.insert(users)
		.values({
			email: over.email ?? 'u@x.c',
			passwordHash: over.passwordHash ?? 'x',
			displayName: over.displayName ?? 'U',
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
