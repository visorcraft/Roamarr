import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { aesKey } from '../crypto';

export const VERSION = 2;
export const CHUNK_SIZE = 64 * 1024;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const INDEX_LENGTH = 4;
export const LEN_LENGTH = 4;
export const HEADER_LENGTH = 1 + LEN_LENGTH + IV_LENGTH;
export const FOOTER_INDEX = 0xffffffff;

function attachmentKey(): Buffer {
	return scryptSync(aesKey(), 'roamarr.attachments.v1', 32);
}

function deriveChunkIV(baseIV: Buffer, index: number): Buffer {
	if (index >= 2 ** 32) {
		throw new Error('attachment chunk index overflow');
	}
	const iv = Buffer.from(baseIV);
	const counter = iv.readUInt32BE(IV_LENGTH - 4);
	iv.writeUInt32BE((counter + index) >>> 0, IV_LENGTH - 4);
	return iv;
}

async function* chunkStream(input: ReadableStream<Uint8Array>, chunkSize: number) {
	const reader = input.getReader();
	let buffer = Buffer.alloc(0);
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (value) {
				buffer = Buffer.concat([buffer, Buffer.from(value)]);
			}
			while (buffer.length >= chunkSize || (done && buffer.length > 0)) {
				const take = Math.min(chunkSize, buffer.length);
				yield buffer.subarray(0, take);
				buffer = buffer.subarray(take);
			}
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
}

async function writeChunk(
	output: ReturnType<typeof createWriteStream>,
	baseIV: Buffer,
	index: number,
	plainChunk: Buffer
): Promise<void> {
	const iv = deriveChunkIV(baseIV, index);
	const cipher = createCipheriv('aes-256-gcm', attachmentKey(), iv);
	const cipherChunk = Buffer.concat([cipher.update(plainChunk), cipher.final()]);
	const tag = cipher.getAuthTag();

	const idxBuf = Buffer.alloc(INDEX_LENGTH);
	idxBuf.writeUInt32BE(index, 0);

	const lenBuf = Buffer.alloc(LEN_LENGTH);
	lenBuf.writeUInt32BE(cipherChunk.length, 0);

	await new Promise<void>((resolve, reject) => {
		output.write(Buffer.concat([idxBuf, lenBuf, cipherChunk, tag]), (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

export interface EncryptResult {
	plaintextBytes: number;
	chunkCount: number;
}

export interface EncryptOptions {
	maxBytes?: number;
}

export async function encryptChunkedFile(
	input: ReadableStream<Uint8Array>,
	outputPath: string,
	options: EncryptOptions = {}
): Promise<EncryptResult> {
	const { maxBytes = Number.MAX_SAFE_INTEGER } = options;
	const baseIV = randomBytes(IV_LENGTH);
	const tempPath = `${outputPath}.tmp`;
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const output = createWriteStream(tempPath);

	await new Promise<void>((resolve, reject) => {
		const sizeBuf = Buffer.alloc(LEN_LENGTH);
		sizeBuf.writeUInt32BE(CHUNK_SIZE, 0);
		output.write(Buffer.concat([Buffer.from([VERSION]), sizeBuf, baseIV]), (err) => {
			if (err) reject(err);
			else resolve();
		});
	});

	let index = 0;
	let plaintextBytes = 0;
	try {
		for await (const plainChunk of chunkStream(input, CHUNK_SIZE)) {
			plaintextBytes += plainChunk.length;
			if (plaintextBytes > maxBytes) {
				throw new Error('attachment exceeds maximum allowed size');
			}
			await writeChunk(output, baseIV, index, plainChunk);
			index++;
		}

		// Footer authenticates total chunk count.
		const footerPlain = Buffer.alloc(8);
		footerPlain.writeBigUInt64BE(BigInt(index), 0);
		await writeChunk(output, baseIV, FOOTER_INDEX, footerPlain);

		await new Promise<void>((resolve, reject) => {
			output.on('finish', resolve);
			output.on('error', reject);
			output.end();
		});

		const handle = await fs.open(tempPath, 'r+');
		await handle.sync();
		await handle.close();
		await fs.rename(tempPath, outputPath);

		return { plaintextBytes, chunkCount: index };
	} catch (e) {
		output.destroy();
		try {
			await fs.unlink(tempPath);
		} catch {
			// ignore cleanup failure
		}
		throw e;
	}
}

export async function decryptChunkedFileStream(cipherPath: string): Promise<ReadableStream<Uint8Array>> {
	const source = createReadStream(cipherPath);

	async function* decryptChunks() {
		const header = await readExactly(source, HEADER_LENGTH);
		if (header.length < HEADER_LENGTH) {
			throw new Error('attachment ciphertext header truncated');
		}
		if (header[0] !== VERSION) {
			throw new Error(`unsupported attachment encryption version: ${header[0]}`);
		}
		const chunkSize = header.readUInt32BE(1);
		const baseIV = header.subarray(1 + LEN_LENGTH, HEADER_LENGTH);

		let dataChunkCount = 0;
		while (true) {
			const idxBuf = await readExactly(source, INDEX_LENGTH);
			if (idxBuf.length === 0) {
				throw new Error('attachment footer missing');
			}
			if (idxBuf.length < INDEX_LENGTH) {
				throw new Error('attachment chunk index truncated');
			}

			const lenBuf = await readExactly(source, LEN_LENGTH);
			if (lenBuf.length < LEN_LENGTH) {
				throw new Error('attachment chunk length truncated');
			}
			const chunkLen = lenBuf.readUInt32BE(0);

			const cipherChunk = await readExactly(source, chunkLen);
			if (cipherChunk.length < chunkLen) {
				throw new Error('attachment chunk ciphertext truncated');
			}

			const tag = await readExactly(source, TAG_LENGTH);
			if (tag.length < TAG_LENGTH) {
				throw new Error('attachment chunk tag truncated');
			}

			const index = idxBuf.readUInt32BE(0);
			if (index === FOOTER_INDEX) {
				const iv = deriveChunkIV(baseIV, FOOTER_INDEX);
				const decipher = createDecipheriv('aes-256-gcm', attachmentKey(), iv);
				decipher.setAuthTag(tag);
				const footerPlain = Buffer.concat([decipher.update(cipherChunk), decipher.final()]);
				const expectedCount = Number(footerPlain.readBigUInt64BE(0));
				if (expectedCount !== dataChunkCount) {
					throw new Error(`attachment chunk count mismatch: expected ${expectedCount}, got ${dataChunkCount}`);
				}
				return;
			}

			if (index !== dataChunkCount) {
				throw new Error(`attachment chunk out of order: expected ${dataChunkCount}, got ${index}`);
			}

			const iv = deriveChunkIV(baseIV, index);
			const decipher = createDecipheriv('aes-256-gcm', attachmentKey(), iv);
			decipher.setAuthTag(tag);
			const plain = Buffer.concat([decipher.update(cipherChunk), decipher.final()]);
			yield plain;
			dataChunkCount++;
		}
	}

	const nodeReadable = Readable.from(decryptChunks(), { objectMode: false });
	nodeReadable.on('error', () => source.destroy());
	return Readable.toWeb(nodeReadable) as ReadableStream<Uint8Array>;
}

function readExactly(stream: ReturnType<typeof createReadStream>, n: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let buf = Buffer.alloc(0);

		function onData(data: Buffer) {
			buf = Buffer.concat([buf, data]);
			if (buf.length >= n) {
				cleanup();
				const result = buf.subarray(0, n);
				if (buf.length > n) {
					stream.unshift(buf.subarray(n));
				}
				resolve(result);
			}
		}

		function onEnd() {
			cleanup();
			resolve(buf);
		}

		function onError(err: Error) {
			cleanup();
			reject(err);
		}

		function cleanup() {
			stream.pause();
			stream.off('data', onData);
			stream.off('end', onEnd);
			stream.off('error', onError);
		}

		stream.on('data', onData);
		stream.on('end', onEnd);
		stream.on('error', onError);
		stream.resume();
	});
}
