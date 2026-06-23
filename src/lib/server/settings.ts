import { eq } from 'drizzle-orm';
import { db } from './db';
import { settings } from './db/schema';

export function getSettings() {
	return db.select().from(settings).where(eq(settings.id, 1)).get()!;
}

export function updateSettings(patch: Partial<typeof settings.$inferInsert>) {
	db.update(settings).set(patch).where(eq(settings.id, 1)).run();
}

export function isSetupComplete() {
	return getSettings().setupComplete;
}
