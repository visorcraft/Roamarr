import path from 'node:path';

export const DEFAULT_DATABASE_PATH = './roamarr.db';

export function getDatabasePath() {
	return process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

export function getAttachmentsPath() {
	return path.join(path.dirname(getDatabasePath()), 'attachments');
}
