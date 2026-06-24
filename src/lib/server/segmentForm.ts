export function combineDateTime(date: string | undefined, time: string | undefined): string | undefined {
	if (!date) return undefined;
	const t = (time ?? '').trim() || '00:00';
	const normalized = t.length === 5 ? t : '00:00';
	return `${date}T${normalized}`;
}

export function parseSegmentDetails(form: FormData): object | undefined {
	const details: Record<string, unknown> = {};
	const bookingInfo: Record<string, string> = {};

	for (const [key, raw] of form.entries()) {
		if (typeof raw !== 'string') continue;
		const value = raw.trim();
		if (!value) continue;

		if (key.startsWith('detail_')) {
			details[key.slice(7)] = value;
			continue;
		}
		if (key.startsWith('booking_')) {
			bookingInfo[key.slice(8)] = value;
		}
	}

	if (form.get('detail_booked') === 'on') details.booked = true;
	if (form.get('detail_sameAsPickup') === 'on') details.sameAsPickup = true;
	if (Object.keys(bookingInfo).length) details.bookingInfo = bookingInfo;

	return Object.keys(details).length ? details : undefined;
}
