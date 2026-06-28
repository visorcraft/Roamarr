import { count } from 'drizzle-orm';
import { db } from './db';
import { geonamesCities } from './db/schema';
import { getSettings as getKitSettings, updateSettings as updateKitSettings } from './repositories/settingsRepo';
import { hasMapTexture, mapTextureImportedAt } from './mapsAssets';
import type { SettingsPatch } from './repositories/settingsRepo';

export type { Settings } from './repositories/settingsRepo';

export function getSettings() {
	return getKitSettings();
}

export function updateSettings(patch: SettingsPatch) {
	updateKitSettings(patch);
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
