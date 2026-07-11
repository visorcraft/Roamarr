import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from '@visorcraft/mongreldb-kit';
import { users } from './mongrelSchema';
import { makeUser } from '../../../../tests/helpers';

describe('getDb encryption', () => {
	const originalPath = process.env.DATABASE_PATH;
	const originalUser = process.env.DATABASE_USER;
	const originalPass = process.env.DATABASE_PASS;
	const dirs: string[] = [];

	beforeEach(() => {
		process.env.DATABASE_PATH = originalPath;
	});

	afterEach(() => {
		process.env.DATABASE_PATH = originalPath;
		if (originalUser === undefined) delete process.env.DATABASE_USER; else process.env.DATABASE_USER = originalUser;
		if (originalPass === undefined) delete process.env.DATABASE_PASS; else process.env.DATABASE_PASS = originalPass;
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		vi.resetModules();
	});

	it('requires DATABASE_USER and DATABASE_PASS together', async () => {
		process.env.DATABASE_USER = 'roamarr';
		delete process.env.DATABASE_PASS;
		const { databaseCredentialsFromEnv } = await import('./index');
		expect(() => databaseCredentialsFromEnv()).toThrow('must both be set');
	});

	it('creates and reopens an encrypted credential-authenticated database', async () => {
		if (!process.env.ROAMARR_SECRET) return;
		const path = tempDbPath();
		const { openOrCreateEncryptedSync } = await import('./index');
		const credentials = { username: 'roamarr', password: 'database-password' };
		const created = openOrCreateEncryptedSync(path, process.env.ROAMARR_SECRET, credentials);
		created.nativeDb.close();
		const reopened = openOrCreateEncryptedSync(path, process.env.ROAMARR_SECRET, credentials);
		expect(reopened.tableNames()).toContain('users');
		reopened.nativeDb.close();
		expect(() => openOrCreateEncryptedSync(path, process.env.ROAMARR_SECRET!, { ...credentials, password: 'wrong' })).toThrow();
	});

	function tempDbPath(): string {
		const dir = mkdtempSync(join(tmpdir(), 'roamarr-encryption-test-'));
		dirs.push(dir);
		return dir;
	}

	it('creates an encrypted database and reopens it with the same secret', async () => {
		if (!process.env.ROAMARR_SECRET) {
			return expect(true).toBe(true);
		}

		const path = tempDbPath();
		process.env.DATABASE_PATH = path;

		// First boot: the singleton must create an encrypted database.
		const { getDb: getDb1 } = await import('./index');
		const db1 = getDb1();
		const user = makeUser(db1, { email: 'encryption@test.local' });
		db1.nativeDb.close();

		// Second boot with the same path+secret must reopen the encrypted file.
		await vi.resetModules();
		const { getDb: getDb2 } = await import('./index');
		const db2 = getDb2();
		const row = db2
			.selectFrom(users)
			.where(eq(users.id, BigInt(user.id)))
			.executeSync()[0];
		expect(row?.email).toBe('encryption@test.local');
		db2.nativeDb.close();
	});
});
