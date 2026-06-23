import { DateTime } from 'luxon';

export const nowIso = () => DateTime.utc().toISO()!;

export const localToUtc = (localIso: string, tz: string) =>
	DateTime.fromISO(localIso, { zone: tz }).toUTC().toISO()!;
