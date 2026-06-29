import type { Migration } from '@mongreldb/kit';
import { userSmtpOverrides, settings } from '../mongrelSchema';

const smtpSecurityMigration: Migration = {
	version: 3,
	name: 'smtp_security_and_override',
	up: (ctx) => {
		const smtpSecurityCol = settings.columns.find((c) => c.name === 'smtp_security');
		if (smtpSecurityCol) ctx.addColumn('settings', smtpSecurityCol);
		ctx.ensureTable(userSmtpOverrides);
	}
};

export const migrations = [smtpSecurityMigration];
