import { DateTime } from 'luxon';

/** Format an ISO timestamp into the value expected by <input type="datetime-local">. */
export function toDatetimeLocal(iso: string | null | undefined, tz = 'UTC'): string {
	if (!iso) return '';
	const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
	if (!dt.isValid) return iso;
	return dt.toFormat("yyyy-MM-dd'T'HH:mm");
}
