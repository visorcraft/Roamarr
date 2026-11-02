import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { MAIL_HOLD_STATUSES } from './db/mongrelSchema';
import {
	createMailHold as repoCreateMailHold,
	deleteMailHold as repoDeleteMailHold,
	getMailHoldById,
	listMailHoldsForTrip,
	updateMailHold as repoUpdateMailHold,
	type MailHold
} from './repositories/tripMiscRepo';
import { getTripById } from './repositories/tripsRepo';
import { getUserById } from './repositories/usersRepo';
import { requireEditableTrip } from './ownership';
import { logAudit } from './audit';
import { Validator, positiveIdFromForm } from './validation';
import { withTripAction } from './actions';
import { setFlash } from './flash';
import {
	coverMailHolds,
	DEFAULT_MAIL_HOLD_LEAD_DAYS,
	nextMailHoldWindow,
	uspsHoldWarning,
	type MailHoldCoverage
} from './mailHoldCoverage';
import { cancelMailHoldReminder, upsertRemindersForMailHold } from './reminders';

export interface MailHoldInput {
	carrier?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	confirmationNumber?: string | null;
	addressLabel?: string | null;
	notes?: string | null;
	status?: string | null;
}

export function listMailHolds(tripId: number): MailHold[] {
	return listMailHoldsForTrip(tripId);
}

export function mailHoldCoverageForTrip(
	startDate: string | null | undefined,
	endDate: string | null | undefined,
	holds: MailHold[]
): MailHoldCoverage {
	return coverMailHolds(startDate, endDate, holds);
}

function parseMailHold(input: MailHoldInput, base?: MailHold): {
	carrier: string;
	startDate: string;
	endDate: string;
	confirmationNumber: string | null;
	addressLabel: string | null;
	notes: string | null;
	status: MailHold['status'];
} {
	const v = new Validator();
	const carrierRaw = input.carrier === undefined ? base?.carrier ?? 'USPS' : input.carrier;
	const carrier = v.requiredString(carrierRaw && String(carrierRaw).trim() ? carrierRaw : 'USPS', 'carrier', { max: 40 }) ?? 'USPS';
	const startDate = v.requiredDate(input.startDate === undefined ? base?.startDate : input.startDate, 'startDate');
	const endDate = v.requiredDate(input.endDate === undefined ? base?.endDate : input.endDate, 'endDate');
	const confirmationNumber = v.optionalString(
		input.confirmationNumber === undefined ? base?.confirmationNumber : input.confirmationNumber,
		'confirmationNumber',
		{ max: 80 }
	);
	const addressLabel = v.optionalString(
		input.addressLabel === undefined ? base?.addressLabel : input.addressLabel,
		'addressLabel',
		{ max: 120 }
	);
	const notes = v.optionalString(input.notes === undefined ? base?.notes : input.notes, 'notes', { max: 2000 });
	const statusRaw = input.status === undefined || input.status === '' ? base?.status ?? 'requested' : input.status;
	const status = v.enumValue(statusRaw, MAIL_HOLD_STATUSES, 'status') ?? base?.status ?? 'requested';
	if (startDate && endDate && endDate < startDate) v.errors.endDate = 'endDate must be on or after startDate';
	if (!v.ok()) throw error(400, Object.values(v.errors)[0] ?? v.failMessage());
	return {
		carrier,
		startDate: startDate!,
		endDate: endDate!,
		confirmationNumber: confirmationNumber ?? null,
		addressLabel: addressLabel ?? null,
		notes: notes ?? null,
		status
	};
}

function syncReminder(hold: MailHold) {
	if (hold.status === 'cancelled' || hold.status === 'ended') {
		cancelMailHoldReminder(hold.id);
		return;
	}
	const trip = getTripById(hold.tripId);
	if (!trip) return;
	const owner = getUserById(trip.ownerId);
	const lead = Number(owner?.mail_hold_lead_days ?? DEFAULT_MAIL_HOLD_LEAD_DAYS);
	upsertRemindersForMailHold(trip.ownerId, hold.id, hold.endDate, owner?.timezone ?? 'UTC', lead);
}

export function addMailHold(userId: number, tripId: number, input: MailHoldInput) {
	requireEditableTrip(userId, tripId);
	const parsed = parseMailHold(input);
	const hold = repoCreateMailHold({ tripId, ...parsed });
	syncReminder(hold);
	logAudit(userId, 'create', 'trip_mail_hold', hold.id, { tripId });
	return { hold, warning: uspsHoldWarning(hold.carrier, hold.startDate, hold.endDate) };
}

export function updateMailHold(userId: number, tripId: number, holdId: number, input: MailHoldInput) {
	requireEditableTrip(userId, tripId);
	const existing = getMailHoldById(holdId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Mail hold not found');
	const parsed = parseMailHold(input, existing);
	const hold = repoUpdateMailHold(holdId, parsed);
	if (!hold) throw error(404, 'Mail hold not found');
	syncReminder(hold);
	logAudit(userId, 'update', 'trip_mail_hold', hold.id, { tripId });
	return { hold, warning: uspsHoldWarning(hold.carrier, hold.startDate, hold.endDate) };
}

export function deleteMailHold(userId: number, tripId: number, holdId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getMailHoldById(holdId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Mail hold not found');
	cancelMailHoldReminder(holdId);
	repoDeleteMailHold(holdId);
	logAudit(userId, 'delete', 'trip_mail_hold', holdId, { tripId });
}

export function addNextMailHold(userId: number, tripId: number, holdId: number) {
	requireEditableTrip(userId, tripId);
	const existing = getMailHoldById(holdId);
	if (!existing || existing.tripId !== tripId) throw error(404, 'Mail hold not found');
	const window = nextMailHoldWindow(existing.endDate);
	return addMailHold(userId, tripId, {
		carrier: existing.carrier,
		startDate: window.startDate,
		endDate: window.endDate,
		addressLabel: existing.addressLabel,
		status: 'requested'
	});
}

function inputFromForm(formData: FormData): MailHoldInput {
	const text = (name: string) => {
		const value = formData.get(name);
		return typeof value === 'string' ? value : '';
	};
	return {
		carrier: text('carrier'),
		startDate: text('startDate'),
		endDate: text('endDate'),
		confirmationNumber: text('confirmationNumber'),
		addressLabel: text('addressLabel'),
		notes: text('notes'),
		status: text('status') || 'requested'
	};
}

function flashWarning(event: RequestEvent, warning: string | null) {
	if (warning) setFlash(event.cookies, { message: warning, variant: 'warning' });
}

export async function addMailHoldAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const result = addMailHold(user.id, tripId, inputFromForm(formData));
	flashWarning(event, result.warning);
	throw redirect(303, `/trips/${tripId}#prep`);
}

export async function updateMailHoldAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const holdIdResult = positiveIdFromForm(formData.get('holdId'), 'holdId');
	if (!holdIdResult.ok) return fail(400, { error: holdIdResult.error });
	const result = updateMailHold(user.id, tripId, holdIdResult.value, inputFromForm(formData));
	flashWarning(event, result.warning);
	throw redirect(303, `/trips/${tripId}#prep`);
}

export async function deleteMailHoldAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const holdIdResult = positiveIdFromForm(formData.get('holdId'), 'holdId');
	if (!holdIdResult.ok) return fail(400, { error: holdIdResult.error });
	deleteMailHold(user.id, tripId, holdIdResult.value);
	throw redirect(303, `/trips/${tripId}#prep`);
}

export async function addNextMailHoldAction(event: RequestEvent) {
	const { user, tripId, formData } = await withTripAction(event);
	const holdIdResult = positiveIdFromForm(formData.get('holdId'), 'holdId');
	if (!holdIdResult.ok) return fail(400, { error: holdIdResult.error });
	const result = addNextMailHold(user.id, tripId, holdIdResult.value);
	flashWarning(event, result.warning);
	throw redirect(303, `/trips/${tripId}#prep`);
}
