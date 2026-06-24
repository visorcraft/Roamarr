export function formatDateTime(
	iso: string | null | undefined,
	opts?: { timeStyle?: 'short' | 'medium'; timeZone?: string }
): string {
	if (!iso) return '';
	try {
		return new Intl.DateTimeFormat('en-US', {
			dateStyle: 'medium',
			timeStyle: opts?.timeStyle ?? 'short',
			...(opts?.timeZone ? { timeZone: opts.timeZone } : {})
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}
