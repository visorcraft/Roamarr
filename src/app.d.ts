import type { ToastVariant } from '$lib/toast';

declare global {
	namespace App {
		interface Error {}
		interface Locals {
			user: import('$lib/server/auth').AppUser | null;
			oauth?: import('$lib/server/oauth').AuthenticatedToken;
			flash?: string | { message: string; variant?: ToastVariant };
			missingSecret?: boolean;
			bootError?: string;
		}
		interface PageData {}
		interface PageState {}
		interface Platform {}
	}
}

export {};
