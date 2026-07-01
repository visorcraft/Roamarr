import type { Migration } from '@visorcraft/mongreldb-kit';
import { passkeys, webauthnChallenges } from '../mongrelSchema';

const passkeysMigration: Migration = {
	version: 6,
	name: 'passkeys',
	up: (ctx) => {
		ctx.ensureTable(passkeys);
		ctx.ensureTable(webauthnChallenges);
	}
};

export const migrations = [passkeysMigration];
