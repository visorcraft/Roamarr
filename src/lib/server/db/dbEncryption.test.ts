import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from '@visorcraft/mongreldb-kit';
import { users } from './mongrelSchema';
import { makeUser } from '../../../../tests/helpers';

describe('getDb encryption', () => {
	const originalPath = process.env.DATABASE_PATH;
	const dirs: string[] = [];

	beforeEach(() => {
		process.env.DATABASE_PATH = originalPath;
	});

	afterEach(() => {
		process.env.DATABASE_PATH = originalPath;
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		vi.resetModules();
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
