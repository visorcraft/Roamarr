import { createDb, type DB } from './createDb';
import * as schema from './schema';

export { createDb, type DB, schema };

const singleton = createDb(process.env.DATABASE_PATH ?? '/data/roamarr.db');
export const db: DB = singleton.db;
export const sqlite = singleton.sqlite;
