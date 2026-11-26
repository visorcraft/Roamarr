/** Shared HTTP download helpers: filename sanitization, RFC 5987 Content-Disposition, and inline-MIME allowlist. */

function truncateUtf8Bytes(text: string, maxBytes: number): string {
	const utf8 = Buffer.from(text, 'utf8');
	if (utf8.length <= maxBytes) return text;
	let end = maxBytes;
	// Never split a multi-byte UTF-8 sequence.
	while (end > 0 && (utf8[end]! & 0xc0) === 0x80) end--;
	return utf8.subarray(0, end).toString('utf8');
}

export function sanitizeDownloadFilename(
	name: string,
	options?: { fallback?: string; requiredExtension?: string }
): string {
	// Strip control chars, quotes, backslashes, and path separators to prevent
	// header injection and ensure a single basename.
	let sanitized = name
		.replace(/[\x00-\x1f\x7f\\/"'\[\]\{\};:|<>?*]/g, '_')
		.replace(/\.{2,}/g, '_')
		.trim();
	// Avoid leading dots and ensure a non-empty fallback.
	sanitized = sanitized.replace(/^[.\s]+/, '') || (options?.fallback ?? 'download');

	const ext = options?.requiredExtension;
	if (ext && !sanitized.toLowerCase().endsWith(ext.toLowerCase())) {
		sanitized += ext;
	}
	if (Buffer.byteLength(sanitized, 'utf8') <= 255) return sanitized;

	if (ext) {
		// Truncate the stem so the final result stays within the limit and keeps the required extension.
		const extBytes = Buffer.byteLength(ext, 'utf8');
		const stem = sanitized.slice(0, sanitized.length - ext.length);
		return truncateUtf8Bytes(stem, 255 - extBytes) + ext;
	}
	return truncateUtf8Bytes(sanitized, 255);
}

export function buildContentDisposition(filename: string, inline = false): string {
	// ASCII-only quoted filename for legacy clients, RFC 5987 filename* for Unicode.
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
	const encoded = encodeURIComponent(filename).replace(
		/['()]/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
	);
	return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Only PDF and non-SVG images may open inline; XML/HTML/SVG/GPX must always download. */
export function canServeInline(contentType: string): boolean {
	return contentType === 'application/pdf' || (contentType.startsWith('image/') && contentType !== 'image/svg+xml');
}
