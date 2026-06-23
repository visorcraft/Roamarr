import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DB } from './createDb';

export function applyMigrations(db: BetterSQLite3Database<Record<string, never>> | DB) {
	migrate(db as BetterSQLite3Database<Record<string, never>>, { migrationsFolder: 'drizzle' });
}
