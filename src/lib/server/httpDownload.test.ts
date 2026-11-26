import { test, expect } from 'vitest';
import { sanitizeDownloadFilename, buildContentDisposition, canServeInline } from './httpDownload';

test('sanitizeDownloadFilename strips control characters and header-injection sequences', () => {
	expect(sanitizeDownloadFilename('a\x00b\x1fc\x7fd')).toBe('a_b_c_d');
	expect(sanitizeDownloadFilename('line1\r\nline2')).toBe('line1__line2');
	expect(sanitizeDownloadFilename('a\x08b\x09c\x0ad')).toBe('a_b_c_d');
});

test('sanitizeDownloadFilename replaces quotes, path separators, and special characters', () => {
	expect(sanitizeDownloadFilename('a/b\\c"d\'e[f]g{h}i;j:k|l<m>n?o*p')).toBe(
		'a_b_c_d_e_f_g_h_i_j_k_l_m_n_o_p'
	);
});

test('sanitizeDownloadFilename collapses runs of dots into a single underscore', () => {
	expect(sanitizeDownloadFilename('a...b')).toBe('a_b');
	expect(sanitizeDownloadFilename('a..b')).toBe('a_b');
	expect(sanitizeDownloadFilename('a.b')).toBe('a.b');
});

test('sanitizeDownloadFilename trims whitespace and strips leading dots/spaces', () => {
	expect(sanitizeDownloadFilename('   hello   ')).toBe('hello');
	expect(sanitizeDownloadFilename('. . . name')).toBe('name');
	expect(sanitizeDownloadFilename(' .  .  name ')).toBe('name');
});

test('sanitizeDownloadFilename falls back to download by default and to custom fallback', () => {
	expect(sanitizeDownloadFilename('')).toBe('download');
	expect(sanitizeDownloadFilename('.')).toBe('download');
	expect(sanitizeDownloadFilename(' . . ')).toBe('download');
	expect(sanitizeDownloadFilename('   ')).toBe('download');
	expect(sanitizeDownloadFilename('.', { fallback: 'track' })).toBe('track');
	expect(sanitizeDownloadFilename('', { fallback: 'track' })).toBe('track');
});

test('sanitizeDownloadFilename appends requiredExtension when missing', () => {
	expect(sanitizeDownloadFilename('mytrack', { requiredExtension: '.gpx' })).toBe('mytrack.gpx');
	expect(sanitizeDownloadFilename('mytrack.gpx', { requiredExtension: '.gpx' })).toBe('mytrack.gpx');
});

test('sanitizeDownloadFilename keeps requiredExtension case-insensitively', () => {
	expect(sanitizeDownloadFilename('mytrack.GPX', { requiredExtension: '.gpx' })).toBe('mytrack.GPX');
	expect(sanitizeDownloadFilename('mytrack.Gpx', { requiredExtension: '.gpx' })).toBe('mytrack.Gpx');
});

test('sanitizeDownloadFilename truncates overlong names to 255 UTF-8 bytes without splitting sequences', () => {
	const longAscii = 'a'.repeat(300);
	const result = sanitizeDownloadFilename(longAscii);
	expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(255);
	expect(result).toBe('a'.repeat(255));
});

test('sanitizeDownloadFilename keeps requiredExtension when truncating overlong names', () => {
	const longAscii = 'a'.repeat(300);
	const result = sanitizeDownloadFilename(longAscii, { requiredExtension: '.gpx' });
	expect(result.endsWith('.gpx')).toBe(true);
	expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(255);
	expect(Buffer.byteLength(result, 'utf8')).toBe(255);
});

test('sanitizeDownloadFilename does not split multi-byte UTF-8 sequences', () => {
	// CJK characters are 3 bytes each; 90 of them = 270 bytes.
	const cjk = '\u4e2d'.repeat(90);
	const result = sanitizeDownloadFilename(cjk);
	expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(255);
	expect(result).not.toContain('\uFFFD');
	expect(result).toBe('\u4e2d'.repeat(85)); // 85 * 3 = 255 bytes exactly

	// Emoji are 4 bytes each; 70 of them = 280 bytes.
	const emoji = '\u{1F600}'.repeat(70);
	const emojiResult = sanitizeDownloadFilename(emoji);
	expect(Buffer.byteLength(emojiResult, 'utf8')).toBeLessThanOrEqual(255);
	expect(emojiResult).not.toContain('\uFFFD');
	expect(emojiResult).toBe('\u{1F600}'.repeat(63)); // 63 * 4 = 252 bytes
});

test('sanitizeDownloadFilename truncates multi-byte stems keeping the required extension', () => {
	const cjk = '\u4e2d'.repeat(90);
	const result = sanitizeDownloadFilename(cjk, { requiredExtension: '.gpx' });
	expect(result.endsWith('.gpx')).toBe(true);
	expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(255);
	expect(result).not.toContain('\uFFFD');
	// Stem limit: 255 - 4 = 251 bytes; 251 / 3 = 83.67 -> 83 CJK chars = 249 bytes
	expect(result).toBe('\u4e2d'.repeat(83) + '.gpx');
});

test('buildContentDisposition defaults to attachment', () => {
	expect(buildContentDisposition('report.pdf')).toBe(
		`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
	);
});

test('buildContentDisposition supports inline', () => {
	expect(buildContentDisposition('report.pdf', true)).toBe(
		`inline; filename="report.pdf"; filename*=UTF-8''report.pdf`
	);
});

test('buildContentDisposition replaces non-ASCII with underscores in filename', () => {
	const result = buildContentDisposition('r\u00e9sum\u00e9.pdf');
	expect(result.startsWith('attachment; filename="r_sum_.pdf"')).toBe(true);
});

test('buildContentDisposition RFC 5987-encodes non-ASCII filename*', () => {
	const result = buildContentDisposition('r\u00e9sum\u00e9.pdf');
	expect(result).toContain(`filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`);
});

test('buildContentDisposition percent-encodes RFC 5987 special characters', () => {
	const result = buildContentDisposition("a'b(c)d.pdf");
	expect(result).toContain(`filename*=UTF-8''a%27b%28c%29d.pdf`);
});

test('canServeInline allows PDF and non-SVG images only', () => {
	expect(canServeInline('application/pdf')).toBe(true);
	expect(canServeInline('image/png')).toBe(true);
	expect(canServeInline('image/jpeg')).toBe(true);
	expect(canServeInline('image/webp')).toBe(true);
	expect(canServeInline('image/svg+xml')).toBe(false);
	expect(canServeInline('application/gpx+xml')).toBe(false);
	expect(canServeInline('text/html')).toBe(false);
	expect(canServeInline('application/octet-stream')).toBe(false);
});
