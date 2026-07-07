import { error } from '@sveltejs/kit';
import { DateTime } from 'luxon';

export function parsePositiveInteger(raw: string | null): number | undefined {
	if (raw == null || raw === '') return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) throw error(400, 'Invalid userId');
	return value;
}

export function parseIsoDateParam(raw: string | null, name: string): string | undefined {
	if (raw == null || raw === '') return undefined;
	const dt = DateTime.fromISO(raw, { zone: 'utc' });
	if (!dt.isValid) throw error(400, `Invalid ${name} date`);
	const adjusted = name === 'to' ? dt.endOf('day') : dt.startOf('day');
	return adjusted.toISO()!;
}
