import { expect, test } from 'vitest';
import { formatFileSize } from './fileSize';

test('formats sub-kilobyte files with one decimal KB', () => {
	expect(formatFileSize(363)).toBe('0.4 KB');
	expect(formatFileSize(512)).toBe('0.5 KB');
	expect(formatFileSize(1)).toBe('0.0 KB');
});

test('formats larger sizes', () => {
	expect(formatFileSize(1536)).toBe('1.5 KB');
	expect(formatFileSize(10 * 1024)).toBe('10 KB');
	expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
	expect(formatFileSize(12 * 1024 * 1024)).toBe('12 MB');
});

test('handles edge values', () => {
	expect(formatFileSize(0)).toBe('0 B');
	expect(formatFileSize(-1)).toBe('0 B');
	expect(formatFileSize(Number.NaN)).toBe('0 B');
});
