import type { Migration } from '@visorcraft/mongreldb-kit';
import { searchDocuments, settings } from '../mongrelSchema';

const embeddingsConfigColumn = settings.columns.find((column) => column.name === 'embeddings_config')!;

export const searchEmbeddingsMigration: Migration = {
	version: 3,
	name: 'search_embeddings',
	ops: [
		{ kind: 'createTable', name: 'search_documents' },
		{ kind: 'alterColumn', table: 'settings', column: 'embeddings_config' }
	],
	up: (ctx) => {
		ctx.ensureTable(searchDocuments);
		ctx.alterColumn('settings', 'embeddings_config', embeddingsConfigColumn);
	}
};
