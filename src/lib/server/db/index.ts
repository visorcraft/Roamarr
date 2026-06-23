import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DB = ReturnType<typeof createDb>['db'];

export function createDb(path: string) {
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	return { db, sqlite };
}

const { db, sqlite } = createDb(process.env.DATABASE_PATH ?? '/data/roamarr.db');
export { db, sqlite, schema };
