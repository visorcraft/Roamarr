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

export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '';
	try {
		return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(
			new Date(`${iso}T12:00:00`)
		);
	} catch {
		return iso;
	}
}

export function formatTime(iso: string | null | undefined, timeZone = 'UTC'): string {
	if (!iso) return '';
	try {
		return new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone }).format(new Date(iso));
	} catch {
		return '';
	}
}
