import type { Migration } from '@visorcraft/mongreldb-kit';
import { visitedCountries, visitedUsStates } from '../mongrelSchema';

const visitedPlacesMigration: Migration = {
	version: 2,
	name: 'visited_places',
	up: (ctx) => {
		ctx.ensureTable(visitedCountries);
		ctx.ensureTable(visitedUsStates);
	}
};

export const migrations = [visitedPlacesMigration];
