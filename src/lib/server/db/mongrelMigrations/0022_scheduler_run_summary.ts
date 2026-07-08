import type { Migration } from '@visorcraft/mongreldb-kit';
import { schedulerRuns } from '../mongrelSchema';

const schedulerRunSummaryMigration: Migration = {
	version: 22,
	name: 'scheduler_run_summary',
	up: (ctx) => {
		const cols = ctx.db.tableColumns('scheduler_runs');
		const col = schedulerRuns.columns.find((c) => c.name === 'summary_json');
		if (col && !cols.includes('summary_json')) {
			ctx.addColumn('scheduler_runs', col);
		}
	}
};

export const migrations = [schedulerRunSummaryMigration];
