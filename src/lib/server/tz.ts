import { DateTime, type DurationLike } from 'luxon';

export const nowIso = () => DateTime.utc().toISO()!;
export const utcIsoAfter = (duration: DurationLike) => DateTime.utc().plus(duration).toISO()!;

export const localToUtc = (localIso: string, tz: string) =>
	DateTime.fromISO(localIso, { zone: tz }).toUTC().toISO()!;

export const utcToLocal = (utcIso: string, tz: string) =>
	DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(tz).toISO()!;
