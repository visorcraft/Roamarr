import type { ToastVariant } from '$lib/toast';

declare global {
	namespace App {
		interface Error {}
		interface Locals {
			user: import('$lib/server/auth').AppUser | null;
			flash?: string | { message: string; variant?: ToastVariant };
		}
		interface PageData {}
		interface PageState {}
		interface Platform {}
	}
}

export {};
