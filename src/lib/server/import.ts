import { randomBytes } from 'node:crypto';
import { SEGMENT_TYPES, type SegmentType } from '$lib/server/db/mongrelSchema';
import * as tripsRepo from '$lib/server/repositories/tripsRepo';
import { Validator } from '$lib/server/validation';
import { localToUtc } from '$lib/server/tz';
import { upsertRemindersForSegment } from '$lib/server/reminders';
import { logAudit } from '$lib/server/audit';
import { createSegment } from '$lib/server/repositories/segmentsRepo';
import { resolveCitySelection } from '$lib/server/cities';

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
	destinationCountryCode?: string;
	destinationAdmin1Code?: string;
	destinationCityName?: string;
	destinationCityLat?: number;
	destinationCityLng?: number;
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
	destinationCountryCode?: string;
	destinationAdmin1Code?: string;
	destinationCityName?: string;
	destinationCityLat?: number;
	destinationCityLng?: number;
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
				destinationCountryCode: obj.destinationCountryCode || undefined,
				destinationAdmin1Code: obj.destinationAdmin1Code || undefined,
				destinationCityName: obj.destinationCityName || undefined,
				destinationCityLat: obj.destinationCityLat ? Number(obj.destinationCityLat) : undefined,
				destinationCityLng: obj.destinationCityLng ? Number(obj.destinationCityLng) : undefined,
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

interface ResolvedImportDestination {
	destinationCountryCode?: string;
	destinationAdmin1Code?: string | null;
	destinationCityName?: string;
	destinationCityLat?: number | null;
	destinationCityLng?: number | null;
}

function validateTrip(
	input: ImportTrip
): { errors: ImportError[]; destination: ResolvedImportDestination } {
	const v = new Validator();
	v.requiredString(input.name, 'name', { max: 200 });
	const countryCode = input.destinationCountryCode
		? v.countryCode(input.destinationCountryCode, 'destinationCountryCode')
		: undefined;
	const admin1CodeRaw = v.optionalString(
		input.destinationAdmin1Code,
		'destinationAdmin1Code',
		{ max: 20 }
	);
	const cityNameRaw = v.optionalString(input.destinationCityName, 'destinationCityName', { max: 200 });
	const cityLat =
		input.destinationCityLat != null ? v.latitude(input.destinationCityLat, 'destinationCityLat') : undefined;
	const cityLng =
		input.destinationCityLng != null ? v.longitude(input.destinationCityLng, 'destinationCityLng') : undefined;

	let destinationCityName = cityNameRaw;
	let destinationCityLat = cityLat ?? null;
	let destinationCityLng = cityLng ?? null;
	let destinationAdmin1Code = admin1CodeRaw ?? null;

	if (countryCode && cityNameRaw) {
		// Same contract as trip create/edit: exact GeoNames matches fill missing coords
		// when maps are enabled; free-text cities are allowed when maps are off.
		const resolved = resolveCitySelection(
			countryCode,
			cityNameRaw,
			cityLat,
			cityLng,
			admin1CodeRaw
		);
		if (!resolved.ok) {
			v.addError('destinationCityName', resolved.error);
		} else {
			destinationCityName = resolved.city.name;
			destinationCityLat = resolved.city.lat;
			destinationCityLng = resolved.city.lng;
			destinationAdmin1Code = resolved.city.admin1Code;
		}
	} else if (countryCode && !cityNameRaw) {
		v.addError('destinationCityName', 'City name is required when a country is provided');
	}

	const startDate = v.date(input.startDate, 'startDate');
	const endDate = v.date(input.endDate, 'endDate');
	v.optionalString(input.notes, 'notes', { max: 5000 });
	v.enumValue(input.defaultVisibility || 'private', ['private', 'groups', 'public'] as const, 'defaultVisibility');
	v.dateRange(startDate, endDate);
	return {
		errors: Object.entries(v.errors).map(([field, message]) => ({ row: 0, field, message })),
		destination: {
			destinationCountryCode: countryCode,
			destinationAdmin1Code,
			destinationCityName,
			destinationCityLat,
			destinationCityLng
		}
	};
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
		const { errors: tripErrorsRaw, destination } = validateTrip(tripInput);
		const tripErrors = tripErrorsRaw.map((e) => ({ ...e, row }));
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
				destinationCountryCode: destination.destinationCountryCode,
				destinationAdmin1Code: destination.destinationAdmin1Code ?? undefined,
				destinationCityName: destination.destinationCityName,
				destinationCityLat: destination.destinationCityLat ?? undefined,
				destinationCityLng: destination.destinationCityLng ?? undefined,
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
		const trip = tripsRepo.createTrip(userId, {
			name: tripInput.name.trim(),
			destinationCountryCode: destination.destinationCountryCode ?? null,
			destinationAdmin1Code: destination.destinationAdmin1Code ?? null,
			destinationCityName: destination.destinationCityName ?? null,
			destinationCityLat: destination.destinationCityLat ?? null,
			destinationCityLng: destination.destinationCityLng ?? null,
			startDate: tripInput.startDate,
			endDate: tripInput.endDate,
			notes: tripInput.notes,
			defaultVisibility: (tripInput.defaultVisibility || 'private') as 'private' | 'groups' | 'public',
			publicToken
		});
		result.imported++;

		for (const segInput of validSegments) {
			const seg = createSegment({
				trip_id: BigInt(trip.id),
				type: segInput.type,
				title: segInput.title.trim(),
				start_at: localToUtc(segInput.localStart, segInput.startTz || 'UTC'),
				start_tz: segInput.startTz || 'UTC',
				end_at: segInput.endAt ?? null,
				location: segInput.location ?? null,
				confirmation_number: segInput.confirmationNumber ?? null,
				details_json: segInput.details ? JSON.stringify(segInput.details) : null,
				card_id: null
			});
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
