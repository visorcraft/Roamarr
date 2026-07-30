/** Human-readable attachment size. Tiny files use one decimal KB so 363 B → "0.4 KB". */
export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
	if (bytes === 0) return '0 B';
	if (bytes < 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	const kb = bytes / 1024;
	if (kb < 1024) return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
	const mb = kb / 1024;
	return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
