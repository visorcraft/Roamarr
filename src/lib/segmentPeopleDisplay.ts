/**
 * Display helpers for people listed on a segment.
 *
 * Email/import pipelines often store the same group as free-text details fields
 * (`passengers`, `tickets`, `guests`, `attendees`, `guest`) rather than as
 * structured `segment_attendees` rows. The itinerary card and Travelers panel
 * need to read those without showing the same names twice.
 */

function detailString(details: Record<string, unknown>, key: string): string {
	const value = details[key];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * Meta lines for the segment card. Guests (occupancy) stay separate; when both
 * ticket numbers and passenger names exist, only tickets are shown (they already
 * include each name).
 */
export function peopleDetailMetaLines(details: Record<string, unknown>): string[] {
	const lines: string[] = [];
	const guests = detailString(details, 'guests');
	if (guests) lines.push(guests);

	const tickets = detailString(details, 'tickets');
	const passengers = detailString(details, 'passengers');
	if (tickets) lines.push(tickets);
	else if (passengers) lines.push(passengers);

	// Shuttle / event free-text "who" when not already covered by passengers.
	const attendees = detailString(details, 'attendees');
	if (attendees && !tickets && !passengers) lines.push(attendees);

	return lines;
}

function pushUniqueName(out: string[], seen: Set<string>, raw: string) {
	const name = raw.trim().replace(/\s+/g, ' ');
	if (!name) return;
	const key = name.toLowerCase();
	if (seen.has(key)) return;
	seen.add(key);
	out.push(name);
}

/**
 * Names for the Travelers panel when structured segment_attendees are empty.
 * Parses tickets (`Name: ticket; …`), passengers (`Name, Name`), attendees, guest.
 */
export function freeTextTravelerNames(details: Record<string, unknown>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();

	const tickets = detailString(details, 'tickets');
	if (tickets) {
		for (const part of tickets.split(/[;\n]+/)) {
			const namePart = part.includes(':') ? part.split(':')[0]! : part;
			pushUniqueName(out, seen, namePart);
		}
	}

	const passengers = detailString(details, 'passengers');
	if (passengers) {
		for (const part of passengers.split(/[,;\n]+/)) {
			pushUniqueName(out, seen, part);
		}
	}

	const attendees = detailString(details, 'attendees');
	if (attendees) {
		for (const part of attendees.split(/[,;\n]+/)) {
			pushUniqueName(out, seen, part);
		}
	}

	const guest = detailString(details, 'guest');
	if (guest) pushUniqueName(out, seen, guest);

	return out;
}
