import * as usersRepo from '../src/lib/server/repositories/usersRepo';

let counter = 0;
let nextExplicitId = 1;

export type UserInsert = {
	id?: bigint;
	email?: string;
	password_hash?: string;
	display_name?: string;
	role?: 'admin' | 'user';
	disabled?: boolean;
	must_reset_password?: boolean;
	timezone?: string;
	flight_checkin_lead_hours?: bigint;
	document_expiry_lead_days?: bigint;
	email_notifications?: boolean;
	webhook_notifications?: boolean;
	theme_id?: string;
	default_currency?: string;
	calendar_token?: string | null;
	calendar_token_expires_at?: string | null;
};

export function makeKitUser(over: UserInsert = {}) {
	const n = counter++;
	const id = over.id ?? BigInt(nextExplicitId++);
	return usersRepo.createUser({
		id,
		email: over.email ?? `u${n}@x.c`,
		password_hash: over.password_hash ?? 'x',
		display_name: over.display_name ?? `U${n}`,
		role: over.role ?? 'user',
		disabled: over.disabled ?? false,
		must_reset_password: over.must_reset_password ?? false,
		timezone: over.timezone ?? 'UTC',
		flight_checkin_lead_hours: over.flight_checkin_lead_hours ?? 24n,
		document_expiry_lead_days: over.document_expiry_lead_days ?? 90n,
		email_notifications: over.email_notifications ?? true,
		webhook_notifications: over.webhook_notifications ?? true,
		theme_id: over.theme_id ?? 'system',
		default_currency: over.default_currency ?? 'USD',
		calendar_token: over.calendar_token ?? null,
		calendar_token_expires_at: over.calendar_token_expires_at ?? null
	} as any);
}
