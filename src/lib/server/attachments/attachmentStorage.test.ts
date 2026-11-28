import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	stageEncryptedAttachment,
	commitAttachment,
	readEncryptedAttachmentStream,
	deleteEncryptedAttachment,
	attachmentPath,
	sweepStaleStagingFiles,
	STAGING_ORPHAN_MAX_AGE_MS
} from './attachmentStorage';
import { streamToBuffer } from '../../../../tests/helpers';

describe('attachmentStorage', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'roamarr-storage-'));
	});
	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	function streamFromString(s: string): ReadableStream<Uint8Array> {
		return new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(Buffer.from(s)));
				controller.close();
			}
		});
	}

	async function save(input: ReadableStream<Uint8Array>) {
		const staged = await stageEncryptedAttachment(input, dir);
		await commitAttachment(staged.stagingPath, staged.finalPath);
		return staged;
	}

	test('stageEncryptedAttachment returns a sharded uuid path and byte count', async () => {
		const result = await save(streamFromString('hello'));
		expect(result.storageKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(result.plaintextBytes).toBe(5);
		const p = attachmentPath(result.storageKey, dir);
		expect(existsSync(p)).toBe(true);
		expect(p).toContain(path.join(result.storageKey.slice(0, 2), result.storageKey.slice(2, 4), result.storageKey));
	});

	test('readEncryptedAttachmentStream decrypts to a stream', async () => {
		const plain = 'stored securely';
		const { storageKey } = await save(streamFromString(plain));
		const stream = await readEncryptedAttachmentStream(storageKey, dir);
		const out = await streamToBuffer(stream);
		expect(out.toString('utf8')).toBe(plain);
	});

	test('deleteEncryptedAttachment removes the ciphertext file', async () => {
		const { storageKey } = await save(streamFromString('x'));
		const p = attachmentPath(storageKey, dir);
		expect(existsSync(p)).toBe(true);
		await deleteEncryptedAttachment(storageKey, dir);
		expect(existsSync(p)).toBe(false);
	});

	test('deleteEncryptedAttachment is idempotent when the file does not exist', async () => {
		const storageKey = '00000000-0000-0000-0000-000000000000';
		const p = attachmentPath(storageKey, dir);
		expect(existsSync(p)).toBe(false);
		await expect(deleteEncryptedAttachment(storageKey, dir)).resolves.toBeUndefined();
		expect(existsSync(p)).toBe(false);
	});

	test('attachmentPath rejects invalid storage keys', () => {
		expect(() => attachmentPath('../../../etc/passwd', dir)).toThrow('invalid attachment storage key');
		expect(() => attachmentPath('not-a-uuid', dir)).toThrow('invalid attachment storage key');
	});

	test('sweepStaleStagingFiles deletes stale .staging files in sharded subdirs', async () => {
		const staleDir = path.join(dir, 'ab', 'cd');
		mkdirSync(staleDir, { recursive: true });
		const staleStaging = path.join(staleDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.staging');
		writeFileSync(staleStaging, 'x');
		const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
		utimesSync(staleStaging, old, old);

		const now = Date.now();
		const removed = await sweepStaleStagingFiles(dir, { now });

		expect(removed).toBe(1);
		expect(existsSync(staleStaging)).toBe(false);
	});

	test('sweepStaleStagingFiles leaves fresh .staging and committed ciphertext files untouched', async () => {
		const freshDir = path.join(dir, 'ef', 'gh');
		mkdirSync(freshDir, { recursive: true });
		const freshStaging = path.join(freshDir, 'fresh.staging');
		const committed = path.join(freshDir, 'committed');
		writeFileSync(freshStaging, 'x');
		writeFileSync(committed, 'x');

		const removed = await sweepStaleStagingFiles(dir, { now: Date.now() });

		expect(removed).toBe(0);
		expect(existsSync(freshStaging)).toBe(true);
		expect(existsSync(committed)).toBe(true);
	});

	test('sweepStaleStagingFiles returns 0 when baseDir does not exist', async () => {
		const removed = await sweepStaleStagingFiles(path.join(dir, 'does-not-exist'));
		expect(removed).toBe(0);
	});

	test('STAGING_ORPHAN_MAX_AGE_MS is one hour', () => {
		expect(STAGING_ORPHAN_MAX_AGE_MS).toBe(60 * 60_000);
	});
});
