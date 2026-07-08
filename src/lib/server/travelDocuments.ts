import {
	createTravelDocument,
	updateTravelDocument,
	type TravelDocument,
	type TravelDocumentInput
} from '$lib/server/repositories/profileRepo';
import { upsertRemindersForDocument } from '$lib/server/reminders';

export type { TravelDocument, TravelDocumentInput };

export function addDocument(userId: number, input: TravelDocumentInput): TravelDocument {
	const doc = createTravelDocument(userId, {
		type: input.type,
		number: input.number,
		issuingAuthority: input.issuingAuthority,
		expiresOn: input.expiresOn,
		notes: input.notes,
		companionId: input.companionId ?? null
	});
	upsertRemindersForDocument(doc);
	return doc;
}

export function updateDocument(
	userId: number,
	id: number,
	input: TravelDocumentInput
): TravelDocument {
	const doc = updateTravelDocument(id, userId, {
		type: input.type,
		number: input.number,
		issuingAuthority: input.issuingAuthority,
		expiresOn: input.expiresOn,
		notes: input.notes,
		companionId: input.companionId ?? null
	})!;
	upsertRemindersForDocument(doc);
	return doc;
}
