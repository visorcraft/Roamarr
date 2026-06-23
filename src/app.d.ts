import type { users } from '$lib/server/db/schema';

declare global {
	namespace App {
		interface Error {}
		interface Locals {
			user: typeof users.$inferSelect | null;
		}
		interface PageData {}
		interface PageState {}
		interface Platform {}
	}
}

export {};
