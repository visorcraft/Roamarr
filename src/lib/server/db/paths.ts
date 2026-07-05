export const DEFAULT_KIT_DATABASE_PATH = './roamarr-db';

function looksLikeDatabaseDirectory(p: string): boolean {
	return !/\.(db|sqlite3|sqlite)$/i.test(p);
}

export function getDatabasePath(): string {
	if (process.env.MONGREL_DATABASE_PATH) {
		return process.env.MONGREL_DATABASE_PATH;
	}

	const databasePath = process.env.DATABASE_PATH;
	if (databasePath && looksLikeDatabaseDirectory(databasePath)) {
		return databasePath;
	}

	return DEFAULT_KIT_DATABASE_PATH;
}
