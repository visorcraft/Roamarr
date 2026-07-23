import type { Migration } from '@visorcraft/mongreldb-kit';
import { migrations as initial } from './0001_initial';
import { tripInvitationsMigration } from './0002_trip_invitations';
import { searchEmbeddingsMigration } from './0003_search_embeddings';
import { settingsEmbeddingsConfigMigration } from './0004_settings_embeddings_config';

export const migrations: Migration[] = [
	...initial,
	tripInvitationsMigration,
	searchEmbeddingsMigration,
	settingsEmbeddingsConfigMigration
];
