import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { SegmentStatus } from './db/mongrelSchema';
import * as tripsRepo from './repositories/tripsRepo';
import { requireOwnedTrip, requireEditableTrip } from './ownership';
import { getSegmentById } from './repositories/segmentsRepo';
import { regenerateCalendarToken, revokeCalendarToken, duplicateTrip } from '../../routes/trips/shared';
import { upsertCustomReminder } from './reminders';
import { duplicateSegment, moveSegmentToDate, setSegmentStatus } from './segments';
import {
	attachInsurancePolicyToTrip,
	detachInsurancePolicyFromTrip
} from './repositories/profileRepo';
import { addComment, deleteComment } from './tripComments';
import { shareItineraryWithContact } from './emergencyContacts';
import { addAttachment } from './tripExpenseAttachments';
import { saveTripTemplate } from './tripTemplates';
import { autoMarkCountriesFromTrip } from './visitedPlaces';
import { setFlash } from './flash';
import { positiveIdFromForm, Validator } from './validation';
import { withTripAction } from './actions';

export async function regenerateCalendarFeed(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	requireOwnedTrip(user.id, tripId);
	const expiresAt = String(formData.get('calendarExpiresAt') || '');
	regenerateCalendarToken(user.id, tripId, expiresAt || null);
	throw redirect(303, `/trips/${tripId}`);
}

export async function revokeCalendarFeed(event: RequestEvent) {
	const { user, tripId } = await withTripAction(event);
	requireOwnedTrip(user.id, tripId);
	revokeCalendarToken(user.id, tripId);
	throw redirect(303, `/trips/${tripId}`);
}

export async function duplicate(event: RequestEvent) {
	const { user, tripId } = await withTripAction(event);
	requireOwnedTrip(user.id, tripId);
	const copy = duplicateTrip(user.id, tripId);
	throw redirect(303, `/trips/${copy.id}`);
}

export async function toggleArchive(event: RequestEvent) {
	const { user, tripId } = await withTripAction(event);
	const t = requireOwnedTrip(user.id, tripId);
	tripsRepo.updateTrip(tripId, { archived: !t.archived });
	throw redirect(303, `/trips/${tripId}`);
}

export async function toggleFavorite(event: RequestEvent) {
	const { user, tripId } = await withTripAction(event);
	const t = requireOwnedTrip(user.id, tripId);
	tripsRepo.updateTrip(tripId, { favorite: !t.favorite });
	throw redirect(303, `/trips/${tripId}`);
}

export async function customReminder(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const t = requireOwnedTrip(user.id, tripId);
	const offset = Number(formData.get('offsetMinutes') ?? 60);
	if (!Number.isFinite(offset) || offset < 0) throw error(400, 'Invalid offset');
	if (!t.startDate) throw error(400, 'Trip has no start date');
	const startAt = `${t.startDate}T09:00:00Z`;
	upsertCustomReminder(user.id, 'trip', tripId, startAt, offset);
	throw redirect(303, `/trips/${tripId}`);
}

export async function segmentReminder(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	requireEditableTrip(user.id, tripId);
	const segmentIdResult = positiveIdFromForm(formData.get('segmentId'), 'segmentId');
	if (!segmentIdResult.ok) throw error(400, segmentIdResult.error);
	const offset = Number(formData.get('offsetMinutes') ?? 60);
	if (!Number.isFinite(offset) || offset < 0) throw error(400, 'Invalid offset');
	const seg = getSegmentById(segmentIdResult.value);
	if (!seg || seg.tripId !== tripId) throw error(404, 'Segment not found');
	upsertCustomReminder(user.id, 'segment', segmentIdResult.value, seg.startAt, offset);
	throw redirect(303, `/trips/${tripId}`);
}

export async function duplicateSegmentAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const segmentIdResult = positiveIdFromForm(formData.get('segmentId'), 'segmentId');
	if (!segmentIdResult.ok) throw error(400, segmentIdResult.error);
	duplicateSegment(user.id, tripId, segmentIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}

export async function setSegmentStatusAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const segmentIdResult = positiveIdFromForm(formData.get('segmentId'), 'segmentId');
	if (!segmentIdResult.ok) throw error(400, segmentIdResult.error);
	const status = String(formData.get('status') || '');
	if (!status) throw error(400, 'Invalid status');
	setSegmentStatus(user.id, tripId, segmentIdResult.value, status as SegmentStatus);
	throw redirect(303, `/trips/${tripId}`);
}

export async function moveSegmentDateAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const v = new Validator();
	const segmentId = v.positiveId(formData.get('segmentId'), 'segmentId');
	const targetDate = v.requiredDate(formData.get('targetDate'), 'targetDate');
	if (!v.ok()) throw error(400, v.failMessage());
	moveSegmentToDate(user.id, tripId, segmentId!, targetDate!);
	throw redirect(303, `/trips/${tripId}`);
}

export async function attachPolicy(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	requireOwnedTrip(user.id, tripId);
	const policyIdResult = positiveIdFromForm(formData.get('policyId'), 'policyId');
	if (!policyIdResult.ok) throw error(400, policyIdResult.error);
	attachInsurancePolicyToTrip(user.id, policyIdResult.value, tripId);
	throw redirect(303, `/trips/${tripId}`);
}

export async function detachPolicy(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	requireOwnedTrip(user.id, tripId);
	const policyIdResult = positiveIdFromForm(formData.get('policyId'), 'policyId');
	if (!policyIdResult.ok) throw error(400, policyIdResult.error);
	detachInsurancePolicyFromTrip(user.id, policyIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}

export async function addCommentAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	requireEditableTrip(user.id, tripId);
	const body = String(formData.get('body') || '');
	if (!body.trim()) throw error(400, 'Comment is required');
	addComment(user.id, tripId, body);
	throw redirect(303, `/trips/${tripId}`);
}

export async function deleteCommentAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const commentIdResult = positiveIdFromForm(formData.get('commentId'), 'commentId');
	if (!commentIdResult.ok) throw error(400, commentIdResult.error);
	deleteComment(user.id, commentIdResult.value);
	throw redirect(303, `/trips/${tripId}`);
}

export async function shareItineraryWithContactAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const contactIdResult = positiveIdFromForm(formData.get('contactId'), 'contactId');
	if (!contactIdResult.ok) throw error(400, contactIdResult.error);
	await shareItineraryWithContact(user.id, tripId, contactIdResult.value, event.url.origin);
	throw redirect(303, `/trips/${tripId}`);
}

export async function addAttachmentAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const expenseIdResult = positiveIdFromForm(formData.get('expenseId'), 'expenseId');
	if (!expenseIdResult.ok) throw error(400, expenseIdResult.error);
	const file = formData.get('file');
	if (!(file instanceof File)) throw error(400, 'File is required');
	await addAttachment(user.id, expenseIdResult.value, file);
	throw redirect(303, `/trips/${tripId}`);
}

export async function saveTripTemplateAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	requireOwnedTrip(user.id, tripId);
	const name = String(formData.get('name') || '').trim();
	if (!name) throw error(400, 'Template name is required');
	saveTripTemplate(user.id, tripId, name);
	throw redirect(303, `/trips/${tripId}`);
}

export async function markVisitedPlacesAction(event: RequestEvent) {
	const { user, tripId } = await withTripAction(event);
	const added = autoMarkCountriesFromTrip(user.id, tripId);
	setFlash(
		event.cookies,
		added.length > 0
			? `Marked ${added.length} countr${added.length === 1 ? 'y' : 'ies'} visited from this trip.`
			: 'No new countries to mark from this trip.'
	);
	throw redirect(303, `/trips/${tripId}`);
}
