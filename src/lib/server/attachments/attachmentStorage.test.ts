import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	saveEncryptedAttachment,
	readEncryptedAttachmentStream,
	deleteEncryptedAttachment,
	attachmentPath
} from './attachmentStorage';

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

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

	test('saveEncryptedAttachment returns a sharded uuid path and byte count', async () => {
		const result = await saveEncryptedAttachment(streamFromString('hello'), dir);
		expect(result.storageKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		expect(result.plaintextBytes).toBe(5);
		const p = attachmentPath(result.storageKey, dir);
		expect(existsSync(p)).toBe(true);
		expect(p).toContain(path.join(result.storageKey.slice(0, 2), result.storageKey.slice(2, 4), result.storageKey));
	});

	test('readEncryptedAttachmentStream decrypts to a stream', async () => {
		const plain = 'stored securely';
		const { storageKey } = await saveEncryptedAttachment(streamFromString(plain), dir);
		const stream = await readEncryptedAttachmentStream(storageKey, dir);
		const out = await streamToBuffer(stream);
		expect(out.toString('utf8')).toBe(plain);
	});

	test('deleteEncryptedAttachment removes the ciphertext file', async () => {
		const { storageKey } = await saveEncryptedAttachment(streamFromString('x'), dir);
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
});
