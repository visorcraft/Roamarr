// Async open/migrate helpers. Production uses the synchronous singleton in
// `./index.ts`; these async variants exist for the schema/migration tests that
// exercise the kit's async API. Keep them in sync with `./index.ts`.
import { KitDatabase, migrate } from '@visorcraft/mongreldb-kit';
import { schema } from './mongrelSchema';
import { migrations } from './mongrelMigrations/0001_initial';
import { getDatabasePath } from './paths';

let _kit: KitDatabase | null = null;

export async function openKitDatabase(path: string): Promise<KitDatabase> {
	const kit = await KitDatabase.open(path, schema);
	await migrate(kit, schema, migrations);
	return kit;
}

export async function getKitDatabase(): Promise<KitDatabase> {
	if (!_kit) {
		_kit = await openKitDatabase(getDatabasePath());
	}
	return _kit;
}
