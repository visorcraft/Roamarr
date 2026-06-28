import { error } from '@sveltejs/kit';
import * as tripsRepo from './repositories/tripsRepo';

export function listComments(tripId: number) {
	return tripsRepo.listCommentsForTrip(tripId);
}

export function addComment(userId: number, tripId: number, body: string) {
	const text = body.trim();
	if (!text) throw error(400, 'Comment is required');
	return tripsRepo.createComment(userId, tripId, text);
}

export function deleteComment(userId: number, commentId: number) {
	return tripsRepo.deleteComment(userId, commentId);
}
