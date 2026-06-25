import type { users } from '$lib/server/db/schema';
import type { ToastVariant } from '$lib/toast';

declare global {
	namespace App {
		interface Error {}
		interface Locals {
			user: typeof users.$inferSelect | null;
			flash?: string | { message: string; variant?: ToastVariant };
		}
		interface PageData {}
		interface PageState {}
		interface Platform {}
	}
}

export {};
