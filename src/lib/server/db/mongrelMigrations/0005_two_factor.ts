import type { Migration } from '@mongreldb/kit';
import { userTwoFactor, twoFactorBackupCodes } from '../mongrelSchema';

const twoFactorMigration: Migration = {
	version: 5,
	name: 'two_factor',
	up: (ctx) => {
		ctx.ensureTable(userTwoFactor);
		ctx.ensureTable(twoFactorBackupCodes);
	}
};

export const migrations = [twoFactorMigration];
