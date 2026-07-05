import { error } from '@sveltejs/kit';
import * as expensesRepo from './repositories/expensesRepo';
import { requireEditableTrip } from './ownership';
import { canView } from './sharing';
import { logAudit } from './audit';
import {
	createAttachment,
	readAttachmentStream,
	deleteAttachment as deleteGenericAttachment
} from './attachments/attachmentService';
import type { AttachmentRecord } from './attachments/attachmentRepo';
import * as tripsRepo from './repositories/tripsRepo';

type AttachmentLinkContext = {
	link: expensesRepo.ExpenseAttachmentLinkRow;
	tripId: number;
};

function requireAttachmentLinkForView(userId: number, linkId: number): AttachmentLinkContext {
	const link = expensesRepo.getExpenseAttachmentLinkById(linkId);
	if (!link) throw error(404, 'Attachment not found');
	const expense = expensesRepo.getExpenseById(link.expenseId);
	if (!expense) throw error(404, 'Expense not found');
	const trip = tripsRepo.getTripById(expense.tripId);
	if (!trip || !canView(userId, trip)) throw error(404, 'Not found');
	return { link, tripId: trip.id };
}

function requireAttachmentLinkForEdit(userId: number, linkId: number): AttachmentLinkContext {
	const link = expensesRepo.getExpenseAttachmentLinkById(linkId);
	if (!link) throw error(404, 'Attachment not found');
	const expense = expensesRepo.getExpenseById(link.expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);
	return { link, tripId: expense.tripId };
}

export async function addAttachment(
	userId: number,
	expenseId: number,
	file: File
): Promise<{ link: expensesRepo.ExpenseAttachmentLinkRow; attachment: AttachmentRecord }> {
	const expense = expensesRepo.getExpenseById(expenseId);
	if (!expense) throw error(404, 'Expense not found');
	requireEditableTrip(userId, expense.tripId);

	const attachment = await createAttachment({
		ownerId: userId,
		file,
		context: { kind: 'expense_receipt', expenseId, tripId: expense.tripId }
	});

	let link: expensesRepo.ExpenseAttachmentLinkRow;
	try {
		link = expensesRepo.createExpenseAttachmentLink(expenseId, attachment.id);
	} catch (e) {
		await deleteGenericAttachment(attachment.id);
		throw e;
	}

	logAudit(userId, 'create', 'trip_expense_attachment', link.id, {
		expenseId,
		attachmentId: attachment.id,
		filename: file.name
	});

	return { link, attachment };
}

export function listAttachments(expenseId: number): expensesRepo.AttachmentRow[] {
	return expensesRepo.listAttachmentsForExpense(expenseId);
}

export async function readAttachment(
	userId: number,
	linkId: number
): Promise<{
	stream: ReadableStream<Uint8Array>;
	record: AttachmentRecord;
	tripId: number;
	expenseId: number;
	linkId: number;
}> {
	const { link, tripId } = requireAttachmentLinkForView(userId, linkId);
	const { stream, record } = await readAttachmentStream(link.attachmentId);
	return { stream, record, tripId, expenseId: link.expenseId, linkId };
}

export async function deleteAttachment(userId: number, linkId: number): Promise<void> {
	const { link } = requireAttachmentLinkForEdit(userId, linkId);
	const attachmentId = link.attachmentId;
	const attachment = await deleteGenericAttachment(attachmentId);
	expensesRepo.deleteExpenseAttachmentLink(link.id);
	logAudit(userId, 'delete', 'trip_expense_attachment', linkId, {
		expenseId: link.expenseId,
		attachmentId,
		filename: attachment.filename
	});
}
