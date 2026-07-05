export const DEFAULT_KIT_DATABASE_PATH = './roamarr-db';

export function getDatabasePath(): string {
	return process.env.DATABASE_PATH || DEFAULT_KIT_DATABASE_PATH;
}
