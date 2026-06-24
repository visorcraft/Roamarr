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
