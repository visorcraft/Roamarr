import type { Migration } from '@visorcraft/mongreldb-kit';
import { settings } from '../mongrelSchema';

const embeddingsConfigColumn = settings.columns.find((column) => column.name === 'embeddings_config')!;

/**
 * 0003_search_embeddings created `search_documents` correctly but used
 * `alterColumn` for `settings.embeddings_config`. Kit `alterColumn` only
 * rewrites an existing column (and is a no-op when the in-memory schema
 * already declares it), so the native column was never added. Inserts that
 * include column id 28 then fail with `column not found: 28`.
 *
 * This migration uses `addColumn`, which is idempotent if the column already
 * exists (e.g. fresh DBs created from the full schema).
 */
export const settingsEmbeddingsConfigMigration: Migration = {
	version: 4,
	name: 'settings_embeddings_config',
	ops: [{ kind: 'addColumn', table: 'settings', column: 'embeddings_config' }],
	up: (ctx) => {
		ctx.addColumn('settings', embeddingsConfigColumn);
	}
};
