import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { aesKey } from '../crypto';

/**
 * Attachment chunked encryption file format (version 2):
 *
 *   [header]                        HEADER_LENGTH = 17 bytes
 *     1 byte  - version (0x02)
 *     4 bytes - chunk size (big-endian uint32)
 *     12 bytes - base IV for GCM
 *   [data chunk] * N
 *     4 bytes - chunk index (big-endian uint32), starting at 0
 *     4 bytes - ciphertext length (big-endian uint32)
 *     N bytes - AES-256-GCM ciphertext
 *     16 bytes - GCM authentication tag
 *   [footer chunk]
 *     4 bytes - footer index (0xffffffff)
 *     4 bytes - ciphertext length (always 8)
 *     8 bytes - total data chunk count (big-endian uint64)
 *     16 bytes - GCM authentication tag
 *
 * Each chunk uses a unique IV derived from the base IV plus the chunk index.
 * The footer index 0xffffffff is reserved and never used for data chunks.
 */

export const VERSION = 2;
export const CHUNK_SIZE = 64 * 1024;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const INDEX_LENGTH = 4;
export const LEN_LENGTH = 4;
export const HEADER_LENGTH = 1 + LEN_LENGTH + IV_LENGTH;
export const FOOTER_INDEX = 0xffffffff;

export class AttachmentSizeLimitError extends Error {
	constructor(message = 'attachment exceeds maximum allowed size') {
		super(message);
		this.name = 'AttachmentSizeLimitError';
	}
}

let cachedAttachmentKeyPromise: Promise<Buffer> | null = null;

function attachmentKey(): Promise<Buffer> {
	if (!cachedAttachmentKeyPromise) {
		cachedAttachmentKeyPromise = new Promise<Buffer>((resolve, reject) => {
			scrypt(aesKey(), 'roamarr.attachments.v1', 32, (err, key) => {
				if (err) reject(err);
				else resolve(key);
			});
		});
	}
	return cachedAttachmentKeyPromise;
}

function deriveChunkIV(baseIV: Buffer, index: number): Buffer {
	if (index >= FOOTER_INDEX) {
		throw new Error('attachment chunk index overflow');
	}
	const iv = Buffer.from(baseIV);
	const counter = iv.readUInt32BE(IV_LENGTH - 4);
	iv.writeUInt32BE((counter + index) >>> 0, IV_LENGTH - 4);
	return iv;
}

function deriveFooterIV(baseIV: Buffer): Buffer {
	const iv = Buffer.from(baseIV);
	const counter = iv.readUInt32BE(IV_LENGTH - 4);
	iv.writeUInt32BE((counter + FOOTER_INDEX) >>> 0, IV_LENGTH - 4);
	return iv;
}

class BufferedReader {
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private buffer = Buffer.alloc(0);
	private done = false;

	constructor(stream: ReadableStream<Uint8Array>) {
		this.reader = stream.getReader();
	}

	async readExactly(n: number): Promise<Buffer> {
		while (!this.done && this.buffer.length < n) {
			const { done, value } = await this.reader.read();
			this.done = done ?? false;
			if (value && value.length > 0) {
				this.buffer = Buffer.concat([this.buffer, Buffer.from(value)]);
			}
		}
		const result = this.buffer.subarray(0, n);
		this.buffer = this.buffer.subarray(n);
		return result;
	}

	release() {
		this.reader.releaseLock();
	}
}

async function* chunkStream(input: ReadableStream<Uint8Array>, chunkSize: number) {
	const reader = input.getReader();
	const chunks: Buffer[] = [];
	let buffered = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (value && value.length > 0) {
				chunks.push(Buffer.from(value));
				buffered += value.length;
			}
			while (buffered >= chunkSize || (done && buffered > 0)) {
				const take = Math.min(chunkSize, buffered);
				if (chunks.length === 1 && chunks[0].length >= take) {
					const chunk = chunks[0];
					yield chunk.subarray(0, take);
					chunks[0] = chunk.subarray(take);
					buffered -= take;
				} else {
					const merged = Buffer.concat(chunks);
					chunks.length = 0;
					yield merged.subarray(0, take);
					const rest = merged.subarray(take);
					if (rest.length > 0) chunks.push(rest);
					buffered = rest.length;
				}
			}
			if (done) break;
		}
	} finally {
		reader.releaseLock();
	}
}

async function writeChunk(
	output: ReturnType<typeof createWriteStream>,
	key: Buffer,
	iv: Buffer,
	index: number,
	plainChunk: Buffer
): Promise<void> {
	const cipher = createCipheriv('aes-256-gcm', key, iv);
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
	const key = await attachmentKey();
	const baseIV = randomBytes(IV_LENGTH);
	const tempPath = `${outputPath}.tmp`;
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const output = createWriteStream(tempPath);

	let index = 0;
	let plaintextBytes = 0;
	try {
		await new Promise<void>((resolve, reject) => {
			const sizeBuf = Buffer.alloc(LEN_LENGTH);
			sizeBuf.writeUInt32BE(CHUNK_SIZE, 0);
			output.write(Buffer.concat([Buffer.from([VERSION]), sizeBuf, baseIV]), (err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		for await (const plainChunk of chunkStream(input, CHUNK_SIZE)) {
			plaintextBytes += plainChunk.length;
			if (plaintextBytes > maxBytes) {
				throw new AttachmentSizeLimitError();
			}
			const iv = deriveChunkIV(baseIV, index);
			await writeChunk(output, key, iv, index, plainChunk);
			index++;
		}

		// Footer authenticates total chunk count.
		const footerPlain = Buffer.alloc(8);
		footerPlain.writeBigUInt64BE(BigInt(index), 0);
		const footerIV = deriveFooterIV(baseIV);
		await writeChunk(output, key, footerIV, FOOTER_INDEX, footerPlain);

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
	const handle = await fs.open(cipherPath, 'r');
	const source = handle.readableWebStream() as ReadableStream<Uint8Array>;
	const buffered = new BufferedReader(source);

	async function* decryptChunks(): AsyncGenerator<Uint8Array, void, unknown> {
		try {
			const key = await attachmentKey();
			const header = await buffered.readExactly(HEADER_LENGTH);
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
				const idxBuf = await buffered.readExactly(INDEX_LENGTH);
				if (idxBuf.length === 0) {
					throw new Error('attachment footer missing');
				}
				if (idxBuf.length < INDEX_LENGTH) {
					throw new Error('attachment chunk index truncated');
				}

				const lenBuf = await buffered.readExactly(LEN_LENGTH);
				if (lenBuf.length < LEN_LENGTH) {
					throw new Error('attachment chunk length truncated');
				}
				const chunkLen = lenBuf.readUInt32BE(0);
				if (chunkLen > chunkSize) {
					throw new Error(`attachment chunk length exceeds stored maximum: ${chunkLen}`);
				}

				const cipherChunk = await buffered.readExactly(chunkLen);
				if (cipherChunk.length < chunkLen) {
					throw new Error('attachment chunk ciphertext truncated');
				}

				const tag = await buffered.readExactly(TAG_LENGTH);
				if (tag.length < TAG_LENGTH) {
					throw new Error('attachment chunk tag truncated');
				}

				const index = idxBuf.readUInt32BE(0);
				if (index === FOOTER_INDEX) {
					const iv = deriveFooterIV(baseIV);
					const decipher = createDecipheriv('aes-256-gcm', key, iv);
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
				const decipher = createDecipheriv('aes-256-gcm', key, iv);
				decipher.setAuthTag(tag);
				const plain = Buffer.concat([decipher.update(cipherChunk), decipher.final()]);
				yield new Uint8Array(plain);
				dataChunkCount++;
			}
		} finally {
			buffered.release();
			await handle.close();
		}
	}

	const iterator = decryptChunks();

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await iterator.next();
				if (value && value.length > 0) {
					controller.enqueue(value);
				}
				if (done) {
					controller.close();
				}
			} catch (err) {
				controller.error(err);
			}
		},
		async cancel() {
			await iterator.return?.();
		}
	});
}

export async function readExactly(stream: ReadableStream<Uint8Array>, n: number): Promise<Buffer> {
	const reader = stream.getReader();
	try {
		const chunks: Buffer[] = [];
		let total = 0;
		while (total < n) {
			const { done, value } = await reader.read();
			if (value && value.length > 0) {
				chunks.push(Buffer.from(value));
				total += value.length;
			}
			if (done) break;
		}
		return Buffer.concat(chunks).subarray(0, n);
	} finally {
		reader.releaseLock();
	}
}
