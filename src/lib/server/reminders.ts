import { DateTime } from 'luxon';

export function computeFireAt(
	kind: 'flight_checkin' | 'document_expiry',
	ref: string,
	tz = 'UTC'
): string {
	if (kind === 'flight_checkin')
		return DateTime.fromISO(ref, { zone: 'utc' }).minus({ hours: 24 }).toUTC().toISO()!;
	return DateTime.fromISO(ref, { zone: tz })
		.set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
		.minus({ days: 90 })
		.toUTC()
		.toISO()!;
}

// Stubs — full implementations added in Task 16.
export function upsertRemindersForSegment(_seg: unknown): void {}
export function cancelRemindersFor(_refType: 'segment' | 'document', _refId: number): void {}
