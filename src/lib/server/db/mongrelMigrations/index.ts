import type { Migration } from '@visorcraft/mongreldb-kit';
import { migrations as initial } from './0001_initial';
import { tripInvitationsMigration } from './0002_trip_invitations';
import { searchEmbeddingsMigration } from './0003_search_embeddings';
import { settingsEmbeddingsConfigMigration } from './0004_settings_embeddings_config';
import { admin1SubdivisionMigration } from './0005_admin1_subdivision';
import { tripDocumentsMigration } from './0006_trip_documents';
import { placesMigration } from './0007_places';
import { tripDayNotesMigration } from './0008_trip_day_notes';
import { galleryImagesMigration } from './0009_gallery_images';
import { placeLinksMigration } from './0010_place_links';
import { apiKeysMigration } from './0011_api_keys';
import { segmentDaySortOrderMigration } from './0012_segment_day_sort_order';
import { oidcSsoMigration } from './0013_oidc_sso';
import { unitsNtfyAutoBackupMigration } from './0014_units_ntfy_autobackup';
import { placeSearchProviderMigration } from './0015_place_search_provider';

export const migrations: Migration[] = [
	...initial,
	tripInvitationsMigration,
	searchEmbeddingsMigration,
	settingsEmbeddingsConfigMigration,
	admin1SubdivisionMigration,
	tripDocumentsMigration,
	placesMigration,
	tripDayNotesMigration,
	galleryImagesMigration,
	placeLinksMigration,
	apiKeysMigration,
	segmentDaySortOrderMigration,
	oidcSsoMigration,
	unitsNtfyAutoBackupMigration,
	placeSearchProviderMigration
];
