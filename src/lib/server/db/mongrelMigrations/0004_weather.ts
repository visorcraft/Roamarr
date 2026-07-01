import type { Migration } from '@visorcraft/mongreldb-kit';
import { weatherCache } from '../mongrelSchema';

const weatherMigration: Migration = {
	version: 4,
	name: 'weather_cache',
	up: (ctx) => {
		ctx.ensureTable(weatherCache);
	}
};

export const migrations = [weatherMigration];
