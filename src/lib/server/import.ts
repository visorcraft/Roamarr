import { randomBytes } from 'node:crypto';
import { db } from '$lib/server/db';
import { trips, segments, SEGMENT_TYPES, type SegmentType } from '$lib/server/db/schema';
import { Validator } from '$lib/server/validation';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';

interface ImportSegment {
	type: SegmentType;
	title: string;
	localStart: string;
	startTz: string;
	endAt?: string;
	location?: string;
	confirmationNumber?: string;
	details?: Record<string, unknown>;
}

interface ImportTrip {
	name: string;
	destination?: string;
	startDate?: string;
	endDate?: string;
	notes?: string;
	defaultVisibility?: string;
	segments?: ImportSegment[];
}

interface ImportError {
	row: number;
	field: string;
	message: string;
}

interface ImportPreviewTrip {
	name: string;
	destination?: string;
	startDate?: string;
	endDate?: string;
	segments: { type: SegmentType; title: string; localStart: string; startTz: string }[];
}

interface ImportResult {
	imported: number;
	segmentCount: number;
	errors: ImportError[];
	preview?: ImportPreviewTrip[];
}

export function parseJson(text: string): { trips: ImportTrip[] } {
	const parsed = JSON.parse(text);
	if (!parsed || typeof parsed !== 'object') throw new Error('JSON must be an object');
	if (!Array.isArray(parsed.trips)) throw new Error('JSON must have a trips array');
	return parsed as { trips: ImportTrip[] };
}

function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i]!;
		const next = line[i + 1];
		if (inQuotes) {
			if (c === '"') {
				if (next === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += c;
			}
		} else {
			if (c === '"') {
				inQuotes = true;
			} else if (c === ',') {
				result.push(current);
				current = '';
			} else {
				current += c;
			}
		}
	}
	result.push(current);
	return result;
}

export function parseCsv(text: string): { trips: ImportTrip[] } {
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length < 2) throw new Error('CSV must have a header and at least one data row');
	const headers = parseCsvLine(lines[0]!);
	const groups = new Map<string, ImportTrip>();
	for (let i = 1; i < lines.length; i++) {
		const row = parseCsvLine(lines[i]!);
		const obj: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			obj[headers[j]!] = row[j] ?? '';
		}
		const key = `${obj.name}|${obj.startDate}|${obj.endDate}`;
		let trip = groups.get(key);
		if (!trip) {
			trip = {
				name: obj.name || '',
				destination: obj.destination || undefined,
				startDate: obj.startDate || undefined,
				endDate: obj.endDate || undefined,
				notes: obj.notes || undefined,
				defaultVisibility: obj.defaultVisibility || 'private'
			};
			groups.set(key, trip);
		}
		if (obj.segmentType) {
			if (!trip.segments) trip.segments = [];
			trip.segments.push({
				type: obj.segmentType as SegmentType,
				title: obj.segmentTitle || obj.segmentType,
				localStart: obj.segmentLocalStart || '',
				startTz: obj.segmentStartTz || 'UTC',
				endAt: obj.segmentEndAt || undefined,
				location: obj.segmentLocation || undefined,
				confirmationNumber: obj.segmentConfirmationNumber || undefined
			});
		}
	}
	return { trips: Array.from(groups.values()) };
}

function validateTrip(input: ImportTrip): ImportError[] {
	const v = new Validator();
	v.requiredString(input.name, 'name', { max: 200 });
	v.optionalString(input.destination, 'destination', { max: 200 });
	const startDate = v.date(input.startDate, 'startDate');
	const endDate = v.date(input.endDate, 'endDate');
	v.optionalString(input.notes, 'notes', { max: 5000 });
	v.enumValue(input.defaultVisibility || 'private', ['private', 'groups', 'public'] as const, 'defaultVisibility');
	v.dateRange(startDate, endDate);
	return Object.entries(v.errors).map(([field, message]) => ({ row: 0, field, message }));
}

function validateSegment(input: ImportSegment, index: number): ImportError[] {
	const v = new Validator();
	v.enumValue(input.type, SEGMENT_TYPES, 'type');
	v.requiredString(input.title, 'title', { max: 200 });
	v.requiredDateTime(input.localStart, 'localStart');
	v.timezone(input.startTz || 'UTC', 'startTz');
	v.dateTime(input.endAt, 'endAt');
	v.optionalString(input.location, 'location', { max: 200 });
	v.optionalString(input.confirmationNumber, 'confirmationNumber', { max: 100 });
	return Object.entries(v.errors).map(([field, message]) => ({
		row: 0,
		field: `segment.${index}.${field}`,
		message
	}));
}

export function importTrips(userId: number, input: { trips: ImportTrip[] }, dryRun = false): ImportResult {
	const result: ImportResult = { imported: 0, segmentCount: 0, errors: [] };
	if (dryRun) result.preview = [];

	for (let i = 0; i < input.trips.length; i++) {
		const tripInput = input.trips[i]!;
		const row = i + 1;
		const tripErrors = validateTrip(tripInput).map((e) => ({ ...e, row }));
		if (tripErrors.length) {
			result.errors.push(...tripErrors);
			continue;
		}

		const validSegments: ImportSegment[] = [];

		if (tripInput.segments) {
			for (let j = 0; j < tripInput.segments.length; j++) {
				const segInput = tripInput.segments[j]!;
				const segErrors = validateSegment(segInput, j).map((e) => ({ ...e, row }));
				if (segErrors.length) {
					result.errors.push(...segErrors);
					continue;
				}
				validSegments.push(segInput);
			}
		}

		if (dryRun) {
			result.preview!.push({
				name: tripInput.name.trim(),
				destination: tripInput.destination,
				startDate: tripInput.startDate,
				endDate: tripInput.endDate,
				segments: validSegments.map((s) => ({
					type: s.type,
					title: s.title.trim(),
					localStart: s.localStart,
					startTz: s.startTz || 'UTC'
				}))
			});
			result.imported++;
			result.segmentCount += validSegments.length;
			continue;
		}

		const publicToken =
			tripInput.defaultVisibility === 'public'
				? randomBytes(24).toString('base64url')
				: null;
		const trip = db
			.insert(trips)
			.values({
				ownerId: userId,
				name: tripInput.name.trim(),
				destination: tripInput.destination,
				startDate: tripInput.startDate,
				endDate: tripInput.endDate,
				notes: tripInput.notes,
				defaultVisibility: tripInput.defaultVisibility || 'private',
				publicToken
			})
			.returning()
			.get();
		result.imported++;

		for (const segInput of validSegments) {
			const seg = db
				.insert(segments)
				.values({
					tripId: trip.id,
					type: segInput.type,
					title: segInput.title.trim(),
					startAt: localToUtc(segInput.localStart, segInput.startTz || 'UTC'),
					startTz: segInput.startTz || 'UTC',
					endAt: segInput.endAt ?? null,
					location: segInput.location ?? null,
					confirmationNumber: segInput.confirmationNumber ?? null,
					detailsJson: segInput.details ? JSON.stringify(segInput.details) : null,
					cardId: null
				})
				.returning()
				.get();
			upsertRemindersForSegment(seg);
			result.segmentCount++;
		}
	}

	if (result.imported > 0 && !dryRun) {
		logAudit(userId, 'bulk_import', 'trips', 0, {
			imported: result.imported,
			segmentCount: result.segmentCount,
			errorCount: result.errors.length
		});
	}

	return result;
}
