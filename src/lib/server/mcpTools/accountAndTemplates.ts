import type { McpToolModule } from './context';
import { logAudit } from '../audit';
import { getSettings } from '../settings';
import { textResult } from './context';

export const accountAndTemplatesTools: McpToolModule = {
	'roamarr_profile_get': {
		scope: 'profile-prefs:read',
		handler: async ({ userId }) => {
			const { getUserById } = await import('../repositories/usersRepo');
			const { getSettings } = await import('../settings');
			const u = getUserById(userId);
			if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
			const settings = getSettings();
			return textResult({
				role: u.role,
				displayName: u.display_name,
				timezone: u.timezone,
				defaultCurrency: u.default_currency,
				flightCheckinLeadHours: Number(u.flight_checkin_lead_hours),
				documentExpiryLeadDays: Number(u.document_expiry_lead_days),
				mailHoldLeadDays: Number(u.mail_hold_lead_days ?? 3),
				themeId: u.theme_id,
				temperatureUnit: u.temperature_unit === 'f' ? 'f' : 'c',
				timeFormat: u.time_format === '12h' ? '12h' : '24h',
				// Instance display formats (same values the web UI uses) for mobile clients.
				dateFormat: settings.defaultDateFormat || 'yyyy-MM-dd',
				datetimeFormat: settings.defaultDatetimeFormat || 'yyyy-MM-dd h:mm a'
			});
		}
	},
	'roamarr_profile_update': {
		scope: 'profile-prefs:write',
		handler: async ({ userId, args }) => {
			const { updateUser, getUserById } = await import('../repositories/usersRepo');
			// updateUser is a full-row set: undefined fields become NULL
			// in the kit. Read the existing user and merge so omitted
			// fields are preserved.
			const existing = getUserById(userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
			// Validate integers inline; do not round-trip through Number +
			// BigInt (precision loss for large ints). Lead hours/days are
			// small in practice but enforce bounds to be safe.
			let leadHours: bigint | undefined;
			if (args.flightCheckinLeadHours != null) {
				const v = Number(args.flightCheckinLeadHours);
				if (!Number.isInteger(v) || v < 0 || v > 168) {
					return { content: [{ type: 'text' as const, text: 'flightCheckinLeadHours must be an integer 0-168' }], isError: true };
				}
				leadHours = BigInt(v);
			}
			let expiryDays: bigint | undefined;
			if (args.documentExpiryLeadDays != null) {
				const v = Number(args.documentExpiryLeadDays);
				if (!Number.isInteger(v) || v < 0 || v > 3650) {
					return { content: [{ type: 'text' as const, text: 'documentExpiryLeadDays must be an integer 0-3650' }], isError: true };
				}
				expiryDays = BigInt(v);
			}
			let mailHoldDays: bigint | undefined;
			if (args.mailHoldLeadDays != null) {
				const v = Number(args.mailHoldLeadDays);
				if (!Number.isInteger(v) || v < 0 || v > 3650) {
					return { content: [{ type: 'text' as const, text: 'mailHoldLeadDays must be an integer 0-3650' }], isError: true };
				}
				mailHoldDays = BigInt(v);
			}
			if (args.temperatureUnit != null && args.temperatureUnit !== 'c' && args.temperatureUnit !== 'f') {
				return { content: [{ type: 'text' as const, text: "temperatureUnit must be 'c' or 'f'" }], isError: true };
			}
			if (args.timeFormat != null && args.timeFormat !== '12h' && args.timeFormat !== '24h') {
				return { content: [{ type: 'text' as const, text: "timeFormat must be '12h' or '24h'" }], isError: true };
			}
			updateUser(userId, {
				display_name: (args.displayName as string | undefined)?.trim() || existing.display_name,
				timezone: (args.timezone as string | undefined) ?? existing.timezone,
				default_currency: (args.defaultCurrency as string | undefined) ?? existing.default_currency,
				flight_checkin_lead_hours: leadHours ?? existing.flight_checkin_lead_hours,
				document_expiry_lead_days: expiryDays ?? existing.document_expiry_lead_days,
				mail_hold_lead_days: mailHoldDays ?? existing.mail_hold_lead_days,
				theme_id: (args.themeId as string | undefined) ?? existing.theme_id,
				temperature_unit: (args.temperatureUnit as 'c' | 'f' | undefined) ?? existing.temperature_unit,
				time_format: (args.timeFormat as '12h' | '24h' | undefined) ?? existing.time_format
			});
			logAudit(userId, 'mcp_profile_update', 'user', userId, {});
			return textResult({ ok: true });
		}
	},
	'roamarr_notification_channels_get': {
		scope: 'notifications:read',
		handler: async ({ userId }) => {
			const { getUserById } = await import('../repositories/usersRepo');
			const u = getUserById(userId);
			if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
			return textResult({
				emailNotifications: Boolean(u.email_notifications),
				webhookNotifications: Boolean(u.webhook_notifications),
				ntfyNotifications: u.ntfy_notifications ?? true
			});
		}
	},
	'roamarr_notification_channels_update': {
		scope: 'notifications:write',
		handler: async ({ userId, args }) => {
			const { updateUser } = await import('../repositories/usersRepo');
			// updateUser's patch treats explicit `undefined` as SQL NULL
			// (the kit merges {...existing, ...patch} then stores null for
			// undefined cells). Only set keys the caller actually supplied
			// so a single-channel update does not null the other column.
			const patch: Record<string, unknown> = {};
			if (args.emailNotifications != null) patch.email_notifications = Boolean(args.emailNotifications);
			if (args.webhookNotifications != null) patch.webhook_notifications = Boolean(args.webhookNotifications);
			if (args.ntfyNotifications != null) patch.ntfy_notifications = Boolean(args.ntfyNotifications);
			if (Object.keys(patch).length === 0) {
				return textResult({ ok: true, unchanged: true });
			}
			updateUser(userId, patch);
			logAudit(userId, 'mcp_notification_channels_update', 'user', userId, patch);
			return textResult({ ok: true });
		}
	},
	'roamarr_user_smtp_get': {
		scope: 'user-smtp:read',
		handler: async ({ userId }) => {
			const { getUserSmtpOverride } = await import('../smtpConfig');
			const o = getUserSmtpOverride(userId);
			if (!o) return textResult({ configured: false });
			return textResult({ configured: true, host: o.host, port: o.port, username: o.username, fromAddress: o.fromAddress, security: o.security });
		}
	},
	'roamarr_user_smtp_set': {
		scope: 'user-smtp:write',
		handler: async ({ userId, args }) => {
			const { upsertUserSmtpOverride } = await import('../smtpConfig');
			// Validate port + security upfront; the helper takes its own
			// patch shape and `undefined` password means "keep existing".
			const port = Number(args.port);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				return { content: [{ type: 'text' as const, text: 'port must be 1-65535' }], isError: true };
			}
			const security = String(args.security ?? 'starttls');
			if (security !== 'none' && security !== 'starttls' && security !== 'ssl/tls') {
				return { content: [{ type: 'text' as const, text: 'security must be none|starttls|ssl/tls' }], isError: true };
			}
			upsertUserSmtpOverride(userId, {
				host: String(args.host),
				port,
				username: String(args.username),
				// undefined → keep saved password; explicit string → set.
				password: args.password === undefined ? undefined : String(args.password),
				fromAddress: String(args.fromAddress),
				security
			});
			logAudit(userId, 'mcp_user_smtp_set', 'user_smtp_override', userId, {});
			return textResult({ ok: true });
		}
	},
	'roamarr_user_smtp_clear': {
		scope: 'user-smtp:write',
		confirm: true,
		handler: async ({ userId }) => {
			const { deleteUserSmtpOverride } = await import('../smtpConfig');
			deleteUserSmtpOverride(userId);
			logAudit(userId, 'mcp_user_smtp_clear', 'user_smtp_override', userId, {});
			return textResult({ ok: true });
		}
	},
	'roamarr_packing_template_list': {
		scope: 'templates:read',
		handler: async ({ userId }) => {
			const { listTemplates } = await import('../packingTemplates');
			return textResult({ items: listTemplates(userId) });
		}
	},
	'roamarr_packing_template_create': {
		scope: 'templates:write',
		handler: async ({ userId, args }) => {
			const { saveTemplate } = await import('../packingTemplates');
			const id = saveTemplate(userId, String(args.name ?? ''), [], Number(args.sourceTripId));
			logAudit(userId, 'mcp_packing_template_create', 'packing_template', id, {});
			return textResult({ id });
		}
	},
	'roamarr_packing_template_delete': {
		scope: 'templates:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deletePackingTemplateForUser } = await import('../repositories/templatesRepo');
			// Owner-scoped delete prevents IDOR: only the template's
			// owner can remove it.
			const id = Number(args.templateId);
			const n = deletePackingTemplateForUser(id, userId);
			if (n === 0) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
			logAudit(userId, 'mcp_packing_template_delete', 'packing_template', id, {});
			return textResult({ ok: true, templateId: Number(args.templateId) });
		}
	},
	'roamarr_trip_template_list': {
		scope: 'templates:read',
		handler: async ({ userId }) => {
			const { listTripTemplates } = await import('../repositories/templatesRepo');
			return textResult({ items: listTripTemplates(userId) });
		}
	},
	'roamarr_trip_template_create': {
		scope: 'templates:write',
		handler: async ({ userId, args }) => {
			const { saveTripTemplate } = await import('../tripTemplates');
			const t = saveTripTemplate(userId, Number(args.sourceTripId), String(args.name ?? ''));
			logAudit(userId, 'mcp_trip_template_create', 'trip_template', t.id, {});
			return textResult({ id: t.id });
		}
	},
	'roamarr_trip_template_apply': {
		scope: 'templates:write',
		handler: async ({ userId, args }) => {
			// Look up the trip_template row (NOT the trips table — the
			// previous impl passed templateId to tripsRepo.getTripById,
			// which silently ignored templates and duplicated whatever
			// trip happened to share the id). Verify the caller owns the
			// template before applying it; duplicateTrip then re-checks
			// ownership of the source trip referenced by the template.
			const { getTripTemplateById } = await import('../repositories/templatesRepo');
			const tpl = getTripTemplateById(Number(args.templateId));
			if (!tpl) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
			if (tpl.userId !== userId) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
			if (tpl.sourceTripId == null) {
				return { content: [{ type: 'text' as const, text: 'Template has no source trip to apply' }], isError: true };
			}
			const { createTripFromTemplate } = await import('../tripTemplates');
			const copy = createTripFromTemplate(userId, tpl.id, {});
			logAudit(userId, 'mcp_trip_template_apply', 'trip', copy.id, { templateId: tpl.id, sourceTripId: tpl.sourceTripId });
			return textResult({ newTripId: copy.id, name: copy.name });
		}
	},
	'roamarr_trip_template_delete': {
		scope: 'templates:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteTripTemplateForUser } = await import('../repositories/templatesRepo');
			const id = Number(args.templateId);
			const n = deleteTripTemplateForUser(id, userId);
			if (n === 0) return { content: [{ type: 'text' as const, text: 'Template not found' }], isError: true };
			logAudit(userId, 'mcp_trip_template_delete', 'trip_template', id, {});
			return textResult({ ok: true, templateId: Number(args.templateId) });
		}
	},
};
