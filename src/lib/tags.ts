export function parseTags(tags: string | string[] | undefined | null): string[] {
	if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === 'string');
	if (!tags) return [];
	try {
		const parsed = JSON.parse(tags);
		if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string');
	} catch {
		// fall through
	}
	return [];
}

export function serializeTags(raw?: string | null): string {
	if (!raw || !raw.trim()) return '[]';
	const tags = raw
		.split(/[,\n]+/)
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	return JSON.stringify([...new Set(tags)]);
}
