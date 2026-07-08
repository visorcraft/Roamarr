import { describe, it, expect } from 'vitest';
import {
	formatDate,
	formatDateTime,
	formatTime,
	DEFAULT_DATE_FORMAT,
	DEFAULT_DATETIME_FORMAT
} from './dateFormat';

describe('formatDate', () => {
	it('formats a date-only ISO with the default format', () => {
		expect(formatDate('2024-07-08')).toBe('2024-07-08');
	});

	it('formats a full ISO timestamp safely', () => {
		expect(formatDate('2024-07-08T00:00:00Z')).toBe('2024-07-08');
	});

	it('respects explicit format override', () => {
		expect(formatDate('2024-07-08', { format: 'MMM d, yyyy' })).toBe('Jul 8, 2024');
	});

	it('falls back to Intl dateStyle when requested', () => {
		const result = formatDate('2024-07-08', { dateStyle: 'long' });
		expect(result).toMatch(/July 8, 2024/);
	});

	it('returns empty string for null/undefined input', () => {
		expect(formatDate(null)).toBe('');
		expect(formatDate(undefined)).toBe('');
	});
});

describe('formatDateTime', () => {
	it('formats with the default datetime format', () => {
		expect(formatDateTime('2024-07-08T12:34:00Z')).toBe('2024-07-08 12:34 PM');
	});

	it('respects explicit timeZone', () => {
		expect(formatDateTime('2024-07-08T12:34:00Z', { timeZone: 'America/New_York' })).toBe(
			'2024-07-08 8:34 AM'
		);
	});

	it('respects offset in input before converting', () => {
		expect(formatDateTime('2024-07-08T12:34:00-05:00', { timeZone: 'UTC' })).toBe(
			'2024-07-08 5:34 PM'
		);
	});

	it('respects explicit format override', () => {
		expect(formatDateTime('2024-07-08T12:34:00Z', { format: 'd MMM yyyy HH:mm' })).toBe(
			'8 Jul 2024 12:34'
		);
	});

	it('falls back to Intl styles when requested', () => {
		const result = formatDateTime('2024-07-08T12:34:00Z', {
			dateStyle: 'short',
			timeStyle: 'medium',
			timeZone: 'UTC'
		});
		expect(result).toMatch(/7\/8\/24.*12:34:00/);
	});

	it('returns empty string for null/undefined input', () => {
		expect(formatDateTime(null)).toBe('');
		expect(formatDateTime(undefined)).toBe('');
	});
});

describe('formatTime', () => {
	it('formats a time with default h:mm a', () => {
		expect(formatTime('2024-07-08T12:34:00Z', 'UTC')).toBe('12:34 PM');
	});

	it('respects explicit format', () => {
		expect(formatTime('2024-07-08T12:34:00Z', 'UTC', 'HH:mm')).toBe('12:34');
	});
});
