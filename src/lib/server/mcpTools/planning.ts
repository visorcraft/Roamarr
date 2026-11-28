import type { McpToolModule } from './context';
import { error } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import * as segmentsRepo from '../repositories/segmentsRepo';
import { requireEditableTrip } from '../ownership';
import { requireViewableTrip } from '../ownership';
import { addItem as addChecklistItem } from '../tripChecklists';
import { viewChecklist } from '../tripChecklists';
import { setBudget } from '../tripBudgets';
import { listBudgetsWithSpent } from '../tripBudgets';
import { logAudit } from '../audit';
import { paginateList } from '../mcpHelpers';
import { optString } from '../mcpHelpers';
import { reqString } from '../mcpHelpers';
import { toPositiveIdArg } from '../mcpArgParsers';
import { validateToolInput } from '../mcpArgParsers';
import { parseReminderOffsetMinutes } from '../mcpArgParsers';
import { parseBudgetSetArgs } from '../mcpArgParsers';
import { hasScope, scopeError, textResult } from './context';

export const planningTools: McpToolModule = {
	'roamarr_packing_item_add': {
		scope: 'packing:write',
		handler: async ({ userId, args }) => {
			const tripId = Number(args.tripId);
			const item = addChecklistItem(userId, tripId, String(args.text ?? ''), args.assignedToCompanionId == null ? null : Number(args.assignedToCompanionId));
			logAudit(userId, 'mcp_packing_add', 'trip_checklist_item', Number(item.id), { tripId });
			return textResult({ id: Number(item.id), tripId, text: item.text });
		}
	},
	'roamarr_packing_list_build': {
		handler: async ({ userId, scopes, args }) => {
			const tripId = Number(args.tripId);
			if (args.templateId) {
				if (!hasScope(scopes, 'packing:write')) return scopeError('packing:write');
				requireEditableTrip(userId, tripId);
				const { applyTemplate } = await import('../packingTemplates');
				applyTemplate(Number(args.templateId), tripId, userId);
				logAudit(userId, 'mcp_packing_build', 'trip', tripId, { templateId: args.templateId });
			} else {
				if (!hasScope(scopes, 'packing:read')) return scopeError('packing:read');
				requireViewableTrip(userId, tripId);
			}
			const checklist = viewChecklist(tripId);
			return textResult({
				tripId,
				items: checklist.items.map((i) => ({ id: Number(i.id), text: i.text, packed: i.packed, assignedToCompanionId: i.assignedToCompanionId, assignedToName: i.assignedToName }))
			});
		}
	},
	'roamarr_budget_set': {
		scope: 'budgets:write',
		handler: async ({ userId, args }) => {
			const parsed = parseBudgetSetArgs(args as Record<string, unknown>);
			if (!parsed.ok) {
				return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
			}
			const validation = validateToolInput(args as Record<string, unknown>);
			if (!validation.ok) return textResult({ error: validation.error });
			requireEditableTrip(userId, parsed.tripId);
			const row = setBudget(parsed.tripId, parsed.category, parsed.amount, parsed.currency);
			logAudit(userId, 'mcp_budget_set', 'trip_budget_category', parsed.tripId, {
				category: parsed.category, amount: parsed.amount, currency: parsed.currency
			});
			return textResult({ ok: true, tripId: parsed.tripId, category: parsed.category, amount: parsed.amount, currency: row.currency });
		}
	},
	'roamarr_budget_update': {
		scope: 'budgets:read',
		handler: async ({ userId, args }) => {
			const tripId = Number(args.tripId);
			requireViewableTrip(userId, tripId);
			const { listExpensesForTrip } = await import('../repositories/expensesRepo');
			const expenses = listExpensesForTrip(tripId);
			const budgets = listBudgetsWithSpent(tripId, expenses);
			return textResult({ tripId, budgets });
		}
	},
	'roamarr_reminder_add': {
		scope: 'reminders:write',
		handler: async ({ userId, args }) => {
			if (args.fireAt != null) {
				const { createReminder } = await import('../repositories/remindersRepo');
				const refType = args.reminderType === 'document' ? 'document' : 'trip';
				if (typeof args.name !== 'string' || !args.name.trim()) return { content: [{ type: 'text' as const, text: 'name is required' }], isError: true };
				if (args.name.length > 200) return { content: [{ type: 'text' as const, text: 'name must be a string up to 200 chars' }], isError: true };
				if (args.description != null && (typeof args.description !== 'string' || args.description.length > 1000)) return { content: [{ type: 'text' as const, text: 'description must be a string up to 1000 chars' }], isError: true };
				const parsedFireAt =
					typeof args.fireAt === 'string' && args.fireAt.trim() !== ''
						? DateTime.fromISO(args.fireAt.trim(), { zone: 'utc' })
						: null;
				const fireAtIso = parsedFireAt?.isValid ? parsedFireAt.toUTC().toISO() : null;
				if (!fireAtIso) return { content: [{ type: 'text' as const, text: 'fireAt must be a valid ISO date and time' }], isError: true };
				const refId = toPositiveIdArg(args.refId);
				if (refId === null) return { content: [{ type: 'text' as const, text: 'refId must be a positive integer' }], isError: true };
				if (refType === 'trip') requireViewableTrip(userId, refId);
				if (refType === 'document') { const { getTravelDocumentById } = await import('../repositories/profileRepo'); if (!getTravelDocumentById(refId, userId)) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true }; }
				const reminder = createReminder({ userId, kind: 'custom', refType, refId, fireAt: fireAtIso, name: args.name.trim(), description: String(args.description ?? '').trim() || null });
				logAudit(userId, 'mcp_reminder_add', 'reminder', reminder.id, {});
				return textResult({ id: reminder.id });
			}
			const { upsertCustomReminder } = await import('../reminders');
			const tripId = toPositiveIdArg(args.tripId);
			if (tripId === null) return { content: [{ type: 'text' as const, text: 'tripId must be a positive integer' }], isError: true };
			let offset: number;
			if (args.offsetMinutes == null) {
				offset = 60;
			} else {
				const parsedOffset = parseReminderOffsetMinutes(args.offsetMinutes);
				if (parsedOffset === null) return { content: [{ type: 'text' as const, text: 'offsetMinutes must be an integer between -10080 and 10080' }], isError: true };
				offset = parsedOffset;
			}
			// Editors of shared trips can attach their own custom
			// trip-start reminders; the reminder is scoped to userId.
			const t = requireEditableTrip(userId, tripId);
			if (!t.startDate) return textResult({ error: 'Trip has no start date' });
			const startAt = `${t.startDate}T09:00:00Z`;
			upsertCustomReminder(userId, 'trip', tripId, startAt, offset);
			logAudit(userId, 'mcp_reminder_add', 'trip', tripId, { offsetMinutes: offset });
			return textResult({ ok: true, tripId, offsetMinutes: offset });
		}
	},
	'roamarr_expense_create': {
		scope: 'expenses:write',
		handler: async ({ userId, args }) => {
			const { addTripExpense } = await import('../tripExpenses/repository');
			const { toCents, reqString, optString } = await import('../mcpHelpers');
			const tripId = Number(args.tripId);
			requireEditableTrip(userId, tripId);
			const amount = toCents(args.amount, 'amount');
			const result = addTripExpense(userId, tripId, {
				description: reqString(args.description, 'description', 500),
				amount,
				currency: optString(args.currency) ?? 'USD',
				category: optString(args.category),
				exchangeRate: args.exchangeRate != null ? toCents(args.exchangeRate, 'exchangeRate') : undefined,
				baseAmount: args.baseAmount != null ? toCents(args.baseAmount, 'baseAmount') : undefined,
				paidByCompanionId: args.paidByCompanionId != null ? Number(args.paidByCompanionId) : undefined,
				splitAmong: Array.isArray(args.splitAmong)
					? args.splitAmong.map((v) => (v === 'owner' ? 'owner' : Number(v)))
					: undefined
			});
			logAudit(userId, 'mcp_expense_create', 'trip_expense', Number(result.id), { tripId, amount });
			return textResult({ id: Number(result.id), tripId, amount });
		}
	},
	'roamarr_expense_list': {
		scope: 'expenses:read',
		handler: async ({ userId, args }) => {
			const { listTripExpenses } = await import('../tripExpenses/repository');
			const tripId = Number(args.tripId);
			requireViewableTrip(userId, tripId);
			const all = listTripExpenses(tripId);
			const page = paginateList(all, args, (e) => e.id);
			return textResult({
				tripId,
				items: page.items,
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_expense_update': {
		scope: 'expenses:write',
		handler: async ({ userId, args }) => {
			const raw = args.expenseId;
			const id = Number(raw);
			if (typeof raw !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
				return { content: [{ type: 'text' as const, text: 'expenseId must be a positive integer' }], isError: true };
			}
			const { updateTripExpense } = await import('../tripExpenses/repository');
			const { toCents, optString } = await import('../mcpHelpers');
			const updated = updateTripExpense(userId, id, {
				description: optString(args.description, 500) ?? undefined,
				amount: args.amount != null ? toCents(args.amount, 'amount') : undefined,
				currency: optString(args.currency) ?? undefined,
				category: optString(args.category) ?? undefined,
				exchangeRate: args.exchangeRate != null ? toCents(args.exchangeRate, 'exchangeRate') : undefined,
				baseAmount: args.baseAmount != null ? toCents(args.baseAmount, 'baseAmount') : undefined,
				paidByCompanionId: args.paidByCompanionId == null ? undefined : Number(args.paidByCompanionId),
				splitAmong: Array.isArray(args.splitAmong) ? args.splitAmong.map((v) => v === 'owner' ? 'owner' : Number(v)) : undefined
			});
			logAudit(userId, 'mcp_expense_update', 'trip_expense', id, {});
			return textResult({ ok: true, expenseId: id, updated });
		}
	},
	'roamarr_expense_delete': {
		scope: 'expenses:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteTripExpense } = await import('../tripExpenses/repository');
			const id = Number(args.expenseId);
			deleteTripExpense(userId, id);
			logAudit(userId, 'mcp_expense_delete', 'trip_expense', id, {});
			return textResult({ ok: true, expenseId: id });
		}
	},
	'roamarr_packing_item_toggle': {
		scope: 'packing:write',
		handler: async ({ userId, args }) => {
			const itemId = toPositiveIdArg(args.itemId);
			if (itemId === null)
				return { content: [{ type: 'text' as const, text: 'itemId must be a positive integer' }], isError: true };
			const { toggleItemById } = await import('../tripChecklists');
			const updated = toggleItemById(userId, itemId);
			logAudit(userId, 'mcp_packing_toggle', 'trip_checklist_item', itemId, { packed: updated.packed });
			return textResult({ ok: true, itemId, packed: updated.packed });
		}
	},
	'roamarr_packing_item_update': {
		scope: 'packing:write',
		handler: async ({ userId, args }) => {
			const itemId = toPositiveIdArg(args.itemId);
			if (itemId === null)
				return { content: [{ type: 'text' as const, text: 'itemId must be a positive integer' }], isError: true };
			const text = args.text;
			const hasText = text != null;
			const hasAssignee = args.assignedToCompanionId !== undefined;
			if (!hasText && !hasAssignee)
				return { content: [{ type: 'text' as const, text: 'Provide text or assignedToCompanionId to update' }], isError: true };
			if (hasText && typeof text !== 'string')
				return { content: [{ type: 'text' as const, text: 'text must be a string' }], isError: true };
			let assignee: number | null = null;
			if (hasAssignee && args.assignedToCompanionId !== null) {
				assignee = toPositiveIdArg(args.assignedToCompanionId);
				if (assignee === null)
					return { content: [{ type: 'text' as const, text: 'assignedToCompanionId must be a positive integer or null' }], isError: true };
			}
			if (hasAssignee) {
				const { getChecklistItemTripId, updateChecklistItem } = await import('../repositories/tripMiscRepo');
				const { requireCompanionOnTrip } = await import('../ownership');
				const tripId = getChecklistItemTripId(itemId);
				if (tripId == null) throw error(404, 'Item not found');
				requireEditableTrip(userId, tripId);
				requireCompanionOnTrip(assignee, tripId);
				if (typeof text === 'string') (await import('../tripChecklists')).renameItem(userId, itemId, text);
				updateChecklistItem(itemId, { assignedToCompanionId: assignee });
			} else if (typeof text === 'string') {
				(await import('../tripChecklists')).renameItem(userId, itemId, text);
			}
			logAudit(userId, 'mcp_packing_update', 'trip_checklist_item', itemId, {});
			return textResult({ ok: true, itemId });
		}
	},
	'roamarr_packing_item_delete': {
		scope: 'packing:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const itemId = toPositiveIdArg(args.itemId);
			if (itemId === null)
				return { content: [{ type: 'text' as const, text: 'itemId must be a positive integer' }], isError: true };
			const { deleteItemById } = await import('../tripChecklists');
			deleteItemById(userId, itemId);
			logAudit(userId, 'mcp_packing_delete', 'trip_checklist_item', itemId, {});
			return textResult({ ok: true, itemId });
		}
	},
	'roamarr_reminder_list': {
		scope: 'reminders:read',
		handler: async ({ userId, args }) => {
			const { listRemindersForUser } = await import('../reminders');
			const { listSegmentsForTrip } = await import('../repositories/segmentsRepo');
			const { requireViewableTrip } = await import('../ownership');
			const all = listRemindersForUser(userId);
			// When tripId is given, include trip-level reminders AND
			// segment-level reminders whose segment belongs to that trip.
			const tripId = args.tripId != null ? Number(args.tripId) : null;
			if (tripId != null) requireViewableTrip(userId, tripId);
			const segIds = new Set(tripId != null ? listSegmentsForTrip(tripId).map((s) => s.id) : []);
			const filtered = tripId != null
				? all.filter((r) =>
						(r.refType === 'trip' && r.refId === tripId) ||
						(r.refType === 'segment' && segIds.has(r.refId))
					)
				: all;
			const page = paginateList(filtered, args, (r) => r.id);
			return textResult({
				items: page.items.map((r) => ({
					id: r.id,
					refType: r.refType,
					refId: r.refId,
					kind: r.kind,
					name: r.name,
					description: r.description,
					fireAt: r.fireAt,
					status: r.status
				})),
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_reminder_update': {
		scope: 'reminders:write',
		handler: async ({ userId, args }) => {
			const id = Number(args.reminderId);
			if (!Number.isSafeInteger(id) || id <= 0) {
				return { content: [{ type: 'text' as const, text: 'reminderId must be a positive integer' }], isError: true };
			}
			// title maps to name and customNote to description, and offsetMinutes re-arms
			// fireAt from the trip start, so a call that mixes both groups is ambiguous.
			const hasRaw = args.fireAt != null || args.name != null || args.description != null || args.refId != null;
			const hasCustom = args.title !== undefined || args.customNote !== undefined || args.offsetMinutes !== undefined;
			if (hasRaw && hasCustom) {
				return { content: [{ type: 'text' as const, text: 'roamarr_reminder_update takes either name/description/fireAt/refId or title/customNote/offsetMinutes per call, not both. Send the other group in a second call.' }], isError: true };
			}
			if (!hasRaw && !hasCustom) return textResult({ ok: true, reminderId: id, updated: false });
			if (hasRaw) {
				const { getReminderById } = await import('../repositories/remindersRepo');
				const reminder = getReminderById(id);
				if (!reminder || reminder.userId !== userId) return { content: [{ type: 'text' as const, text: 'Reminder not found' }], isError: true };
				const { safeUpdateReminderFields } = await import('../reminders');
				safeUpdateReminderFields(userId, id, {
					name: args.name == null ? undefined : (args.name as string),
					description: args.description == null ? undefined : (args.description as string),
					fireAt: args.fireAt == null ? undefined : (args.fireAt as string),
					refId: args.refId == null ? undefined : typeof args.refId === 'boolean' ? NaN : Number(args.refId)
				});
				logAudit(userId, 'mcp_reminder_update', 'reminder', id, {});
				return textResult({ ok: true, reminderId: id });
			}
			const { safeUpdateCustomReminder } = await import('../reminders');
			let offsetMinutes: number | undefined;
			if (args.offsetMinutes != null) {
				const parsedOffset = parseReminderOffsetMinutes(args.offsetMinutes);
				if (parsedOffset === null) return { content: [{ type: 'text' as const, text: 'offsetMinutes must be an integer between -10080 and 10080' }], isError: true };
				offsetMinutes = parsedOffset;
			}
			safeUpdateCustomReminder(userId, id, {
				title: args.title as string | undefined,
				customNote: args.customNote as string | undefined,
				offsetMinutes
			});
			logAudit(userId, 'mcp_reminder_update', 'reminder', id, {});
			return textResult({ ok: true, reminderId: id });
		}
	},
	'roamarr_reminder_delete': {
		scope: 'reminders:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const id = toPositiveIdArg(args.reminderId);
			if (id === null) {
				return { content: [{ type: 'text' as const, text: 'reminderId must be a positive integer' }], isError: true };
			}
			const { cancelReminder } = await import('../reminders');
			cancelReminder(userId, id);
			logAudit(userId, 'mcp_reminder_delete', 'reminder', id, {});
			return textResult({ ok: true, reminderId: id });
		}
	},
};
