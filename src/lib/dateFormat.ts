import { DateTime } from 'luxon';

export const DEFAULT_DATE_FORMAT = 'yyyy-MM-dd';
export const DEFAULT_DATETIME_FORMAT = 'yyyy-MM-dd h:mm a';

/**
 * Dropdown options for the General settings page. Each value is a Luxon
 * format token string; the label is a sample rendering the user sees.
 */
export const DATE_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'yyyy-MM-dd', label: '2026-07-29' },
	{ value: 'MM/dd/yyyy', label: '07/29/2026' },
	{ value: 'dd/MM/yyyy', label: '29/07/2026' },
	{ value: 'MMM d, yyyy', label: 'Jul 29, 2026' },
	{ value: 'd MMM yyyy', label: '29 Jul 2026' },
	{ value: 'EEEE, MMM d, yyyy', label: 'Tuesday, July 29, 2026' }
];

export const DATETIME_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'yyyy-MM-dd h:mm a', label: '2026-07-29 12:34 PM' },
	{ value: 'yyyy-MM-dd HH:mm', label: '2026-07-29 12:34' },
	{ value: 'MM/dd/yyyy h:mm a', label: '07/29/2026 12:34 PM' },
	{ value: 'MM/dd/yyyy HH:mm', label: '07/29/2026 12:34' },
	{ value: 'dd/MM/yyyy h:mm a', label: '29/07/2026 12:34 PM' },
	{ value: 'dd/MM/yyyy HH:mm', label: '29/07/2026 12:34' },
	{ value: 'MMM d, yyyy h:mm a', label: 'Jul 29, 2026 12:34 PM' },
	{ value: 'MMM d, yyyy HH:mm', label: 'Jul 29, 2026 12:34' },
	{ value: 'd MMM yyyy HH:mm', label: '29 Jul 2026 12:34' },
	{ value: 'd MMM yyyy HH:mm:ss', label: '29 Jul 2026 12:34:56' }
];

interface FormatOptions {
	/** Luxon format token string (e.g. 'yyyy-MM-dd h:mm a'). Overrides dateStyle/timeStyle. */
	format?: string;
	/** Legacy Intl dateStyle. Ignored when `format` is provided. */
	dateStyle?: 'short' | 'medium' | 'long';
	/** Legacy Intl timeStyle. Ignored when `format` is provided. */
	timeStyle?: 'short' | 'medium';
	timeZone?: string;
}

export function formatDateTime(iso: string | null | undefined, opts: FormatOptions = {}): string {
	if (!iso) return '';
	try {
		if (opts.format) {
			const dt = DateTime.fromISO(iso).setZone(opts.timeZone ?? 'utc');
			if (!dt.isValid) return iso;
			return dt.toFormat(opts.format);
		}
		if (opts.dateStyle || opts.timeStyle) {
			return new Intl.DateTimeFormat('en-US', {
				dateStyle: opts.dateStyle ?? 'medium',
				timeStyle: opts.timeStyle ?? 'short',
				...(opts.timeZone ? { timeZone: opts.timeZone } : {})
			}).format(new Date(iso));
		}
		const dt = DateTime.fromISO(iso).setZone(opts.timeZone ?? 'utc');
		if (!dt.isValid) return iso;
		return dt.toFormat(DEFAULT_DATETIME_FORMAT);
	} catch {
		return iso;
	}
}

export function formatDate(
	iso: string | null | undefined,
	opts: { format?: string; dateStyle?: 'short' | 'medium' | 'long' } = {}
): string {
	if (!iso) return '';
	try {
		if (opts.format) {
			const dt = DateTime.fromISO(iso, { zone: 'utc' }).startOf('day');
			if (!dt.isValid) return iso;
			return dt.toFormat(opts.format);
		}
		if (opts.dateStyle) {
			return new Intl.DateTimeFormat('en-US', { dateStyle: opts.dateStyle }).format(
				new Date(`${iso}T12:00:00`)
			);
		}
		const dt = DateTime.fromISO(iso, { zone: 'utc' }).startOf('day');
		if (!dt.isValid) return iso;
		return dt.toFormat(DEFAULT_DATE_FORMAT);
	} catch {
		return iso;
	}
}

export function formatTime(
	iso: string | null | undefined,
	timeZone = 'UTC',
	format = 'h:mm a'
): string {
	if (!iso) return '';
	try {
		const dt = DateTime.fromISO(iso, { zone: timeZone });
		if (!dt.isValid) return '';
		return dt.toFormat(format);
	} catch {
		return '';
	}
}
