import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ctx = vi.hoisted(() => ({ kit: null as never }));
vi.mock('../db', async () => {
	const { freshDb } = await import('../../../../tests/helpers');
	Object.assign(ctx, freshDb());
	return ctx;
});

import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment
} from './attachmentService';
import { attachments as attachmentsTable, auditLogs } from '../db/mongrelSchema';
import { and, eq, type KitDatabase } from '@visorcraft/mongreldb-kit';
import { makeSyncedUser, streamToBuffer } from '../../../../tests/helpers';
import * as attachmentStorage from './attachmentStorage';
import * as repo from './attachmentRepo';

function getKit(): KitDatabase {
	return (ctx as { kit: KitDatabase }).kit;
}

describe('attachmentService', () => {
	let baseDir: string;
	let userId: number;
	let emailCounter = 0;
	let originalAttachmentsPath: string | undefined;

	beforeEach(() => {
		originalAttachmentsPath = process.env.ATTACHMENTS_PATH;
		baseDir = mkdtempSync(path.join(tmpdir(), 'roamarr-svc-'));
		process.env.ATTACHMENTS_PATH = baseDir;
		const kit = getKit();
		kit.deleteFrom(attachmentsTable).executeSync();
		kit.deleteFrom(auditLogs).executeSync();
		const u = makeSyncedUser(kit, {
			email: `a${emailCounter++}@b.c`,
			passwordHash: 'x',
			displayName: 'A'
		});
		userId = Number(u.id);
	});

	afterEach(() => {
		if (existsSync(baseDir)) rmSync(baseDir, { recursive: true, force: true });
		if (originalAttachmentsPath === undefined) {
			delete process.env.ATTACHMENTS_PATH;
		} else {
			process.env.ATTACHMENTS_PATH = originalAttachmentsPath;
		}
	});

	const MAGIC_PREFIX: Record<string, Uint8Array> = {
		'application/pdf': new Uint8Array([0x25, 0x50, 0x44, 0x46]),
		'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		'image/jpeg': new Uint8Array([0xff, 0xd8, 0xff]),
		'image/webp': new Uint8Array([0x52, 0x49, 0x46, 0x46])
	};

	function fileFromString(s: string, name: string, type: string) {
		const prefix = MAGIC_PREFIX[type];
		if (!prefix) return new File([s], name, { type });
		const body = typeof s === 'string' ? Buffer.from(s) : s;
		return new File([Buffer.concat([prefix, body])], name, { type });
	}

	test('createAttachment stores metadata and ciphertext', async () => {
		const file = fileFromString('hello', 'note.pdf', 'application/pdf');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		expect(att.filename).toBe('note.pdf');
		expect(att.contentType).toBe('application/pdf');
		expect(att.sizeBytes).toBe(9); // 4-byte PDF magic + 'hello'
		expect(att.storageKey).toBeTruthy();
	});

	test('readAttachmentStream decrypts the stored file', async () => {
		const file = fileFromString('round trip', 'note.pdf', 'application/pdf');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		const { stream } = await readAttachmentStream(att.id);
		const out = await streamToBuffer(stream);
		expect(out.toString('utf8')).toBe('%PDFround trip');
	});

	test('deleteAttachment removes row and ciphertext', async () => {
		const file = fileFromString('x', 'x.pdf', 'application/pdf');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		await deleteAttachment(att.id);
		const kit = getKit();
		const rows = kit.selectFrom(attachmentsTable).where(eq(attachmentsTable.id, BigInt(att.id))).executeSync();
		expect(rows).toHaveLength(0);
	});

	test('rejects disallowed content types', async () => {
		const file = fileFromString('x', 'x.exe', 'application/x-msdownload');
		await expect(createAttachment({ ownerId: userId, file, context: {} })).rejects.toMatchObject({ status: 400 });
	});

	test('rejects content type mismatched to file bytes', async () => {
		const file = new File(['not a real pdf'], 'fake.pdf', { type: 'application/pdf' });
		await expect(createAttachment({ ownerId: userId, file, context: {} })).rejects.toMatchObject({ status: 400 });
	});

	test('rejects oversized files', async () => {
		const file = fileFromString('x'.repeat(10 * 1024 * 1024 + 1), 'x.png', 'image/png');
		await expect(createAttachment({ ownerId: userId, file, context: {} })).rejects.toMatchObject({ status: 400 });
	});

	test('readAttachmentStream returns 404 for missing attachment', async () => {
		await expect(readAttachmentStream(999999)).rejects.toMatchObject({ status: 404 });
	});

	test('deleteAttachment returns 404 for missing attachment', async () => {
		await expect(deleteAttachment(999999)).rejects.toMatchObject({ status: 404 });
	});

	test('deleteAttachment removes the ciphertext file from disk', async () => {
		const file = fileFromString('disk test', 'disk.pdf', 'application/pdf');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		const cipherPath = attachmentStorage.attachmentPath(att.storageKey, baseDir);
		expect(existsSync(cipherPath)).toBe(true);

		await deleteAttachment(att.id);

		expect(existsSync(cipherPath)).toBe(false);
	});

	test('createAttachment writes an audit log entry', async () => {
		const file = fileFromString('audit', 'audit.pdf', 'application/pdf');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });

		const kit = getKit();
		const logs = kit
			.selectFrom(auditLogs)
			.where(
				and(
					eq(auditLogs.action, 'create'),
					eq(auditLogs.entity_type, 'attachment'),
					eq(auditLogs.entity_id, BigInt(att.id))
				)
			)
			.executeSync();
		expect(logs).toHaveLength(1);
		expect(logs[0].user_id).toBe(BigInt(userId));
	});

	test('deleteAttachment writes an audit log entry', async () => {
		const file = fileFromString('audit', 'audit.pdf', 'application/pdf');
		const att = await createAttachment({ ownerId: userId, file, context: { kind: 'test' } });
		await deleteAttachment(att.id);

		const kit = getKit();
		const logs = kit
			.selectFrom(auditLogs)
			.where(
				and(
					eq(auditLogs.action, 'delete'),
					eq(auditLogs.entity_type, 'attachment'),
					eq(auditLogs.entity_id, BigInt(att.id))
				)
			)
			.executeSync();
		expect(logs).toHaveLength(1);
		expect(logs[0].user_id).toBe(BigInt(userId));
	});

	function countFilesRecursively(dir: string): number {
		let count = 0;
		for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
			if (entry.isFile()) count++;
		}
		return count;
	}

	test('cleans up staged ciphertext file when DB insert fails', async () => {
		vi.spyOn(repo, 'createAttachment').mockImplementationOnce(() => {
			throw new Error('db boom');
		});
		const abortSpy = vi.spyOn(attachmentStorage, 'abortAttachment');

		const file = fileFromString('staging', 'staging.pdf', 'application/pdf');
		await expect(
			createAttachment({ ownerId: userId, file, context: { kind: 'test' } })
		).rejects.toThrow('db boom');

		expect(abortSpy).toHaveBeenCalledTimes(1);
		expect(countFilesRecursively(baseDir)).toBe(0);
	});

	test('cleans up temp ciphertext when encryption fails', async () => {
		const file = fileFromString('x', 'big.png', 'image/png');
		const largeStream = new ReadableStream<Uint8Array<ArrayBuffer>>({
			pull(controller) {
				controller.enqueue(new Uint8Array(Buffer.alloc(11 * 1024 * 1024, 0x78)));
				controller.close();
			}
		});
		file.stream = () => largeStream;

		await expect(
			createAttachment({ ownerId: userId, file, context: {} })
		).rejects.toMatchObject({ status: 400 });

		expect(countFilesRecursively(baseDir)).toBe(0);
	});
});
