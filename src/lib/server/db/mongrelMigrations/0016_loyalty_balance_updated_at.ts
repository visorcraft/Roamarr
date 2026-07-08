import type { Migration } from '@visorcraft/mongreldb-kit';
import { loyaltyPrograms } from '../mongrelSchema';

const loyaltyBalanceUpdatedAtMigration: Migration = {
	version: 16,
	name: 'loyalty_balance_updated_at',
	up: (ctx) => {
		const col = loyaltyPrograms.columns.find((c) => c.name === 'balance_updated_at');
		if (col) ctx.addColumn('loyalty_programs', col);
	}
};

export const migrations = [loyaltyBalanceUpdatedAtMigration];
