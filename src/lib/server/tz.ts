import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { trips } from './db/schema';

export const nowIso = () => DateTime.utc().toISO()!;

export const bumpTripUpdatedAt = (tripId: number) => {
	db.update(trips).set({ updatedAt: nowIso() }).where(eq(trips.id, tripId)).run();
};

export const localToUtc = (localIso: string, tz: string) =>
	DateTime.fromISO(localIso, { zone: tz }).toUTC().toISO()!;

export const utcToLocal = (utcIso: string, tz: string) =>
	DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz).toISO()!;
