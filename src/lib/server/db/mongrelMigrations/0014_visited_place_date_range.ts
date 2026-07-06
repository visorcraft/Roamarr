import type { Migration } from '@visorcraft/mongreldb-kit';
import { visitedCountries, visitedUsStates } from '../mongrelSchema';

const visitedPlaceDateRangeMigration: Migration = {
	version: 14,
	name: 'visited_place_date_range',
	up: (ctx) => {
		const countryFirst = visitedCountries.columns.find((c) => c.name === 'first_visited_on');
		const countryLast = visitedCountries.columns.find((c) => c.name === 'last_visited_on');
		const stateFirst = visitedUsStates.columns.find((c) => c.name === 'first_visited_on');
		const stateLast = visitedUsStates.columns.find((c) => c.name === 'last_visited_on');
		if (countryFirst) ctx.addColumn('visited_countries', countryFirst);
		if (countryLast) ctx.addColumn('visited_countries', countryLast);
		if (stateFirst) ctx.addColumn('visited_us_states', stateFirst);
		if (stateLast) ctx.addColumn('visited_us_states', stateLast);
	}
};

export const migrations = [visitedPlaceDateRangeMigration];
