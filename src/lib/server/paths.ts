import path from 'node:path';
import { DEFAULT_KIT_DATABASE_PATH, getDatabasePath } from './db/paths';

export { DEFAULT_KIT_DATABASE_PATH as DEFAULT_DATABASE_PATH, getDatabasePath };

const DATABASE_FILE_EXTENSIONS = new Set(['.db', '.sqlite', '.kitdb']);

export function getAttachmentsPath(dbPath: string = getDatabasePath()): string {
	if (process.env.ATTACHMENTS_PATH) {
		return path.resolve(process.env.ATTACHMENTS_PATH);
	}

	const ext = path.extname(dbPath).toLowerCase();
	if (DATABASE_FILE_EXTENSIONS.has(ext)) {
		return path.join(path.dirname(dbPath), 'attachments');
	}

	return path.join(dbPath, 'attachments');
}
