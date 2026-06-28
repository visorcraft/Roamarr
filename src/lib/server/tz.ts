import { DateTime } from 'luxon';
import * as tripsRepo from './repositories/tripsRepo';

export const nowIso = () => DateTime.utc().toISO()!;

export const bumpTripUpdatedAt = (tripId: number) => {
	tripsRepo.updateTrip(tripId, { updatedAt: nowIso() });
};

export const localToUtc = (localIso: string, tz: string) =>
	DateTime.fromISO(localIso, { zone: tz }).toUTC().toISO()!;

export const utcToLocal = (utcIso: string, tz: string) =>
	DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz).toISO()!;
