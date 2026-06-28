import {
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	renameSync,
	cpSync,
	rmSync,
	statSync
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import mongreldb from 'mongreldb';
import type { Database as NativeDatabase } from 'mongreldb/native.js';
import { getDatabasePath } from './db/paths';

const NativeDatabaseClass = (mongreldb as unknown as { Database: typeof NativeDatabase }).Database;

export type RestoreMarker = {
	databasePath: string;
	attachmentsPath?: string;
};

export function getAttachmentsPath(dbPath: string = getDatabasePath()): string {
	return process.env.ATTACHMENTS_PATH ?? join(dbPath, 'attachments');
}

export function getRestoreMarkerPath(dbPath: string = getDatabasePath()): string {
	return join(resolve(dirname(dbPath)), 'restore-pending.json');
}

export function readRestoreMarker(dbPath: string = getDatabasePath()): RestoreMarker | null {
	const path = getRestoreMarkerPath(dbPath);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as RestoreMarker;
	} catch {
		return null;
	}
}

export function writeRestoreMarker(
	extractedDbPath: string,
	extractedAttachmentsPath?: string,
	dbPath: string = getDatabasePath()
): void {
	const marker: RestoreMarker = { databasePath: resolve(extractedDbPath) };
	if (extractedAttachmentsPath) {
		marker.attachmentsPath = resolve(extractedAttachmentsPath);
	}
	writeFileSync(getRestoreMarkerPath(dbPath), JSON.stringify(marker));
}

export function removeRestoreMarker(dbPath: string = getDatabasePath()): void {
	try {
		rmSync(getRestoreMarkerPath(dbPath), { force: true });
	} catch {
		// ignore best-effort cleanup failures
	}
}

function isMongrelDbDirectory(dir: string): boolean {
	return (
		existsSync(dir) &&
		statSync(dir).isDirectory() &&
		existsSync(join(dir, 'CATALOG')) &&
		existsSync(join(dir, 'tables'))
	);
}

export function findMongrelDbDirectory(root: string): string | null {
	for (const entry of readdirSync(root)) {
		const candidate = join(root, entry);
		if (isMongrelDbDirectory(candidate)) return candidate;
	}
	return null;
}

export function findAttachmentsDirectory(root: string): string | null {
	const defaultName = join(root, 'attachments');
	if (existsSync(defaultName) && statSync(defaultName).isDirectory()) return defaultName;
	return null;
}

export function validateRestoredDirectory(dir: string): void {
	if (!isMongrelDbDirectory(dir)) {
		throw new Error('Extracted directory is not a valid MongrelDB database');
	}

	const db = NativeDatabaseClass.open(dir);
	try {
		const doctorReport = JSON.parse(db.doctor()) as { ok: boolean; quarantined?: unknown[] };
		if (!doctorReport.ok) {
			throw new Error(`Integrity check failed: ${JSON.stringify(doctorReport)}`);
		}

		const names = new Set(db.tableNames());
		if (!names.has('__kit_schema_migrations') || !names.has('settings')) {
			throw new Error('Backup is missing required tables');
		}
	} finally {
		db.close();
	}
}

function swapDirectory(target: string, source: string): void {
	const targetPath = resolve(target);
	const sourcePath = resolve(source);
	const oldPath = `${targetPath}.old`;

	if (!existsSync(sourcePath)) {
		throw new Error(`Restored directory not found: ${sourcePath}`);
	}

	// Remove any stale .old directory from a previous attempt.
	rmSync(oldPath, { recursive: true, force: true });

	if (existsSync(targetPath)) {
		renameSync(targetPath, oldPath);
	}

	try {
		renameSync(sourcePath, targetPath);
	} catch (err) {
		// Cross-device or unexpected rename failure: copy instead.
		cpSync(sourcePath, targetPath, { recursive: true, force: true, dereference: true });
		rmSync(sourcePath, { recursive: true, force: true });
	}
}

export function cleanupRestoreOldDirectories(dbPath: string = getDatabasePath()): void {
	rmSync(`${resolve(dbPath)}.old`, { recursive: true, force: true });
	rmSync(`${resolve(getAttachmentsPath(dbPath))}.old`, { recursive: true, force: true });
}

export function applyPendingRestore(dbPath: string = getDatabasePath()): void {
	const marker = readRestoreMarker(dbPath);
	if (!marker) return;

	// Capture the wrapper directory (mkdtemp-created `.roamarr-restore-*` next
	// to the live database) before swapDirectory consumes the inner subtree via
	// rename. After the swaps, this wrapper is empty and must be removed.
	const wrapperDirs = new Set<string>();
	for (const p of [marker.databasePath, marker.attachmentsPath]) {
		if (!p) continue;
		let dir = p;
		for (let i = 0; i < 3 && dir !== dirname(dir); i++) {
			const base = basename(dir);
			if (base.startsWith('.roamarr-restore-')) {
				wrapperDirs.add(dir);
				break;
			}
			dir = dirname(dir);
		}
	}

	swapDirectory(dbPath, marker.databasePath);

	if (marker.attachmentsPath) {
		swapDirectory(getAttachmentsPath(dbPath), marker.attachmentsPath);
	}

	removeRestoreMarker(dbPath);

	for (const wrapper of wrapperDirs) {
		try {
			rmSync(wrapper, { recursive: true, force: true });
		} catch {
			// ignore best-effort cleanup failures
		}
	}
}
