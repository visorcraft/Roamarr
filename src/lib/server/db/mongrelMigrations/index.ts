import type { Migration } from '@visorcraft/mongreldb-kit';
import { migrations as initial } from './0001_initial';
import { tripInvitationsMigration } from './0002_trip_invitations';
import { searchEmbeddingsMigration } from './0003_search_embeddings';
import { settingsEmbeddingsConfigMigration } from './0004_settings_embeddings_config';
import { admin1SubdivisionMigration } from './0005_admin1_subdivision';
import { tripDocumentsMigration } from './0006_trip_documents';

export const migrations: Migration[] = [
	...initial,
	tripInvitationsMigration,
	searchEmbeddingsMigration,
	settingsEmbeddingsConfigMigration,
	admin1SubdivisionMigration,
	tripDocumentsMigration
];
