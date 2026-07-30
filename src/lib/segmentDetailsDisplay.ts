/**
 * Display helpers for segment detailsJson on the selected-segment Notes panel.
 *
 * Type-specific fields (and nested bookingInfo from BookingInfoSection) are stored
 * as structured JSON. The UI must flatten nested objects into label/value rows
 * instead of dumping JSON.stringify output.
 */

export type NotesDetailRow = { label: string; value: string };

/** Labels that match BookingInfoSection form fields when nested under bookingInfo. */
const BOOKING_INFO_LABELS: Record<string, string> = {
	site: 'Booking site',
	reference: 'Booking reference',
	website: 'Booking website',
	phone: 'Booking phone',
	date: 'Booking date',
	rate: 'Booking rate',
	restrictions: 'Restrictions'
};

/** Prefer human labels for common top-level detail keys. */
const DETAIL_LABELS: Record<string, string> = {
	attendees: 'Attendees',
	booked: 'Booked',
	bookingInfo: 'Booking info',
	provider: 'Provider',
	phone: 'Phone',
	email: 'Email',
	whatsapp: 'WhatsApp',
	notes: 'Notes',
	website: 'Website',
	partySize: 'Party size',
	totalCost: 'Total cost',
	sameAsPickup: 'Same as pickup',
	pickupLocation: 'Pickup location',
	dropoffLocation: 'Drop-off location',
	dropoffAddress: 'Drop-off address',
	dropoffPhone: 'Drop-off phone',
	carType: 'Car type',
	mileageCharges: 'Mileage charges',
	carDetails: 'Car details',
	drivers: 'Drivers',
	departAirport: 'Departure airport',
	arriveAirport: 'Arrival airport',
	frequentFlyer: 'Frequent flyer #',
	dressCode: 'Dress code',
	meetingPoint: 'Meeting point'
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyDetailValue(value: unknown): boolean {
	if (value == null || value === '') return true;
	if (typeof value === 'string' && !value.trim()) return true;
	return false;
}

/** camelCase / snake_case / PascalCase → Title Case words. */
export function humanizeDetailKey(key: string): string {
	const spaced = key
		.replaceAll('_', ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim();
	if (!spaced) return key;
	return spaced
		.split(' ')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

export function formatDetailValue(value: unknown): string {
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value)) {
		return value
			.map((item) => (isPlainObject(item) ? JSON.stringify(item) : formatDetailValue(item)))
			.filter((item) => item !== '')
			.join(', ');
	}
	if (isPlainObject(value)) return JSON.stringify(value);
	return value == null ? '' : String(value);
}

function labelForKey(key: string): string {
	return DETAIL_LABELS[key] ?? humanizeDetailKey(key);
}

function labelForBookingSubkey(subKey: string): string {
	return BOOKING_INFO_LABELS[subKey] ?? `Booking ${humanizeDetailKey(subKey).toLowerCase()}`;
}

/**
 * Flatten detailsJson into ordered label/value rows for the Notes tab.
 * Nested plain objects (especially bookingInfo) expand into one row per field.
 */
export function segmentNotesRows(details: Record<string, unknown>): NotesDetailRow[] {
	const rows: NotesDetailRow[] = [];

	for (const [key, value] of Object.entries(details)) {
		if (isEmptyDetailValue(value)) continue;

		if (isPlainObject(value)) {
			const nestedEntries = Object.entries(value).filter(([, v]) => !isEmptyDetailValue(v));
			if (!nestedEntries.length) continue;

			const useBookingLabels = key === 'bookingInfo';
			for (const [subKey, subVal] of nestedEntries) {
				if (isPlainObject(subVal)) {
					// One more level: "Provider · Site" style, still no raw blob.
					for (const [deepKey, deepVal] of Object.entries(subVal)) {
						if (isEmptyDetailValue(deepVal) || isPlainObject(deepVal)) continue;
						rows.push({
							label: `${labelForKey(key)} · ${humanizeDetailKey(subKey)} · ${humanizeDetailKey(deepKey)}`,
							value: formatDetailValue(deepVal)
						});
					}
					continue;
				}
				rows.push({
					label: useBookingLabels ? labelForBookingSubkey(subKey) : `${labelForKey(key)} · ${humanizeDetailKey(subKey)}`,
					value: formatDetailValue(subVal)
				});
			}
			continue;
		}

		rows.push({ label: labelForKey(key), value: formatDetailValue(value) });
	}

	return rows;
}
