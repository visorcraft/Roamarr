import { error } from '@sveltejs/kit';
import { Validator } from './validation';
import { SEGMENT_PAYMENT_STATUSES, SEGMENT_TYPES, type SegmentType } from './db/mongrelSchema';

export function parseMobileSegment(body: Record<string, unknown>, fallbackTimezone = 'UTC') {
	const validator = new Validator(), type = validator.enumValue(String(body.type ?? ''), SEGMENT_TYPES, 'type');
	const title = validator.requiredString(body.title, 'title', { max: 200 }), localStart = validator.requiredDateTime(body.localStart, 'localStart');
	const startTz = validator.timezone(body.startTz || fallbackTimezone, 'startTz'), endAt = validator.dateTime(body.endAt, 'endAt'), endTz = validator.timezone(body.endTz || startTz || fallbackTimezone, 'endTz');
	const location = validator.optionalString(body.location, 'location', { max: 200 }), countryCode = body.countryCode ? validator.countryCode(body.countryCode, 'countryCode') : undefined;
	const cityName = validator.optionalString(body.cityName, 'cityName', { max: 200 }), cityLat = body.cityLat === '' || body.cityLat == null ? undefined : validator.latitude(body.cityLat, 'cityLat'), cityLng = body.cityLng === '' || body.cityLng == null ? undefined : validator.longitude(body.cityLng, 'cityLng');
	const venue = validator.optionalString(body.venue, 'venue', { max: 200 }), confirmationNumber = validator.optionalString(body.confirmationNumber, 'confirmationNumber', { max: 100 }), meetingPoint = validator.optionalString(body.meetingPoint, 'meetingPoint', { max: 200 }), meetingAt = validator.dateTime(body.meetingAt, 'meetingAt');
	const cardId = body.cardId === '' || body.cardId == null ? undefined : validator.positiveId(body.cardId, 'cardId'), paymentStatus = body.paymentStatus ? validator.enumValue(String(body.paymentStatus), SEGMENT_PAYMENT_STATUSES, 'paymentStatus') : undefined, paymentDueDate = validator.date(body.paymentDueDate, 'paymentDueDate');
	let details: object | undefined; if (body.details && typeof body.details === 'object' && !Array.isArray(body.details)) details = body.details as object; else if (typeof body.detailsJson === 'string' && body.detailsJson.trim()) { try { details = JSON.parse(body.detailsJson); } catch { validator.addError('detailsJson', 'Invalid details JSON'); } }
	if (!validator.ok()) throw error(400, validator.failMessage());
	return { type: type as SegmentType, title: title!, localStart: localStart!, startTz: startTz!, endAt: endAt ?? undefined, endTz: endTz ?? undefined, location, countryCode, cityName, cityLat, cityLng, venue, confirmationNumber, cardId, details, meetingPoint, meetingAt: meetingAt ?? undefined, paymentStatus, paymentDueDate };
}
