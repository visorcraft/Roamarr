import { count, eq } from 'drizzle-orm';
import { db } from './db';
import { geonamesCities, settings } from './db/schema';
import { hasMapTexture, mapTextureImportedAt } from './mapsAssets';

export function getSettings() {
	return db.select().from(settings).where(eq(settings.id, 1)).get()!;
}

export function updateSettings(patch: Partial<typeof settings.$inferInsert>) {
	db.update(settings).set(patch).where(eq(settings.id, 1)).run();
}

export function isSetupComplete() {
	return getSettings().setupComplete;
}

export function getMapSettings() {
	const s = getSettings();
	const cityCount = db.select({ count: count() }).from(geonamesCities).get()?.count ?? 0;
	return {
		mapsEnabled: s.mapsEnabled,
		mapsGeonamesImportedAt: s.mapsGeonamesImportedAt,
		mapsTileProvider: s.mapsTileProvider,
		mapsTileUrl: s.mapsTileUrl,
		mapsTileAttribution: s.mapsTileAttribution,
		mapsTileApiKey: s.mapsTileApiKey ? '********' : '',
		cityCount,
		textureReady: hasMapTexture(),
		textureImportedAt: mapTextureImportedAt()
	};
}
