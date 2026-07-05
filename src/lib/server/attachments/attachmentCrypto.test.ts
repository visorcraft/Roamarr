import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	encryptChunkedFile,
	decryptChunkedFileStream,
	CHUNK_SIZE,
	INDEX_LENGTH,
	LEN_LENGTH,
	TAG_LENGTH,
	HEADER_LENGTH
} from './attachmentCrypto';

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

function streamFromBuffer(b: Buffer | string): ReadableStream<Uint8Array> {
	const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(buf));
			controller.close();
		}
	});
}

function streamFromBufferChunks(b: Buffer, chunkSize: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= b.length) {
				controller.close();
				return;
			}
			const end = Math.min(b.length, offset + chunkSize);
			controller.enqueue(new Uint8Array(b.subarray(offset, end)));
			offset = end;
		}
	});
}

describe('attachmentCrypto', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), 'roamarr-attach-'));
		process.env.ROAMARR_SECRET = 'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';
	});
	afterEach(() => {
		if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	test('round-trips a small file', async () => {
		const plain = 'hello encrypted world';
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.toString('utf8')).toBe(plain);
	});

	test('round-trips a 1 MB file', async () => {
		const plain = Buffer.alloc(1024 * 1024, 'a');
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBufferChunks(plain, 8192), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.equals(plain)).toBe(true);
	});

	test('round-trips an empty file', async () => {
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(''), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.length).toBe(0);
	});

	test('round-trips a file that spans multiple chunks', async () => {
		const plain = Buffer.alloc(CHUNK_SIZE * 3 + 17, 'x');
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBufferChunks(plain, CHUNK_SIZE), cipherPath);
		const out = await streamToBuffer(await decryptChunkedFileStream(cipherPath));
		expect(out.equals(plain)).toBe(true);
	});

	test('reports actual plaintext bytes and chunk count', async () => {
		const plain = Buffer.alloc(CHUNK_SIZE + 100, 'y');
		const cipherPath = path.join(dir, 'cipher');
		const result = await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		expect(result.plaintextBytes).toBe(plain.length);
		expect(result.chunkCount).toBe(2);
	});

	test('enforces maxBytes during encryption', async () => {
		const plain = Buffer.alloc(100);
		const cipherPath = path.join(dir, 'cipher');
		await expect(
			encryptChunkedFile(streamFromBuffer(plain), cipherPath, { maxBytes: 50 })
		).rejects.toThrow();
	});

	test('tampered chunk fails decryption', async () => {
		const plain = 'secret';
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		bytes[30] ^= 0xff;
		writeFileSync(cipherPath, bytes);
		await expect(streamToBuffer(await decryptChunkedFileStream(cipherPath))).rejects.toThrow();
	});

	test('truncated final tag fails decryption', async () => {
		const plain = 'secret';
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		writeFileSync(cipherPath, bytes.subarray(0, bytes.length - 4));
		await expect(streamToBuffer(await decryptChunkedFileStream(cipherPath))).rejects.toThrow();
	});

	test('truncation at a chunk boundary fails decryption', async () => {
		const plain = Buffer.alloc(CHUNK_SIZE * 2, 'z');
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer(plain), cipherPath);
		const bytes = readFileSync(cipherPath);
		const footerStart = findFooterStart(bytes);
		expect(footerStart).toBeGreaterThan(0);
		const chunkStart = findPreviousChunkStart(bytes, footerStart);
		writeFileSync(cipherPath, bytes.subarray(0, chunkStart));
		await expect(streamToBuffer(await decryptChunkedFileStream(cipherPath))).rejects.toThrow();
	});

	test('encrypted file has version 2 header', async () => {
		const cipherPath = path.join(dir, 'cipher');
		await encryptChunkedFile(streamFromBuffer('x'), cipherPath);
		const bytes = readFileSync(cipherPath);
		expect(bytes[0]).toBe(2);
		expect(bytes.length).toBeGreaterThan(1 + 4 + 12 + 4 + 4 + 16 + 1);
	});
});

function findFooterStart(bytes: Buffer): number {
	for (let i = bytes.length - TAG_LENGTH - LEN_LENGTH; i >= HEADER_LENGTH + INDEX_LENGTH + LEN_LENGTH; i--) {
		if (bytes.readUInt32BE(i - INDEX_LENGTH) === 0xffffffff && bytes.readUInt32BE(i) === 8) {
			return i - INDEX_LENGTH;
		}
	}
	return -1;
}

function findPreviousChunkStart(bytes: Buffer, footerStart: number): number {
	let pos = footerStart;
	pos -= TAG_LENGTH + 8 + LEN_LENGTH + INDEX_LENGTH;
	if (pos < HEADER_LENGTH) return HEADER_LENGTH;
	const len = bytes.readUInt32BE(pos);
	pos -= len + LEN_LENGTH + INDEX_LENGTH;
	return Math.max(HEADER_LENGTH, pos);
}
