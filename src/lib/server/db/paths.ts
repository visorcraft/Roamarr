export function getDatabasePath(): string {
	return process.env.DATABASE_PATH ?? './roamarr.db';
}
