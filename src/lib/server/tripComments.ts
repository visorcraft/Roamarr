import { eq, and } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { db } from './db';
import { tripComments, users } from './db/schema';

export function listComments(tripId: number) {
	return db
		.select({
			id: tripComments.id,
			body: tripComments.body,
			createdAt: tripComments.createdAt,
			userId: users.id,
			displayName: users.displayName
		})
		.from(tripComments)
		.innerJoin(users, eq(tripComments.userId, users.id))
		.where(eq(tripComments.tripId, tripId))
		.orderBy(tripComments.createdAt)
		.all();
}

export function addComment(userId: number, tripId: number, body: string) {
	const text = body.trim();
	if (!text) throw error(400, 'Comment is required');
	return db.insert(tripComments).values({ userId, tripId, body: text }).returning().get();
}

export function deleteComment(userId: number, commentId: number) {
	return db
		.delete(tripComments)
		.where(and(eq(tripComments.id, commentId), eq(tripComments.userId, userId)))
		.run();
}
