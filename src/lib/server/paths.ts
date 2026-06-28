import path from 'node:path';
import { DEFAULT_KIT_DATABASE_PATH, getDatabasePath } from './db/paths';

export { DEFAULT_KIT_DATABASE_PATH as DEFAULT_DATABASE_PATH, getDatabasePath };

export function getAttachmentsPath() {
	return path.join(path.dirname(getDatabasePath()), 'attachments');
}
