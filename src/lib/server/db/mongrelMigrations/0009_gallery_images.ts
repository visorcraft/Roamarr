import type { Migration } from '@visorcraft/mongreldb-kit';
import { galleryImages } from '../mongrelSchema';

/**
 * Multi-image galleries for saved places and trips. owner_id is polymorphic
 * (place or trip); rows are cleaned up in application code when the owner is
 * deleted. attachment_id cascades with the encrypted attachment store.
 */
export const galleryImagesMigration: Migration = {
	version: 9,
	name: 'gallery_images',
	ops: [{ kind: 'createTable', name: 'gallery_images' }],
	up: (ctx) => {
		ctx.ensureTable(galleryImages);
	}
};
