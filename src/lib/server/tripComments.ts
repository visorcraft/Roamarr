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

export function updateComment(userId: number, commentId: number, body: string) {
	const text = body.trim();
	if (!text) throw error(400, 'Comment is required');
	const comment = tripsRepo.updateComment(userId, commentId, text);
	if (!comment) throw error(404, 'Not found');
	return comment;
}

export function deleteComment(userId: number, commentId: number) {
	return tripsRepo.deleteComment(userId, commentId);
}
