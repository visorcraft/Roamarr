import type { McpToolModule } from './context';
import { error } from '@sveltejs/kit';
import * as tripsRepo from '../repositories/tripsRepo';
import type { SharePermission } from '../repositories/tripsRepo';
import { requireOwnedTrip } from '../ownership';
import { requireOwnedGroup } from '../ownership';
import { logAudit } from '../audit';
import { parseShareArgs } from '../mcpArgParsers';
import { textResult } from './context';

export const sharingAndContactsTools: McpToolModule = {
	'roamarr_share_list': {
		scope: 'sharing:read',
		handler: async ({ userId, args }) => {
			const { listSharesForTrip } = await import('../repositories/tripsRepo');
			const tripId = Number(args.tripId);
			requireOwnedTrip(userId, tripId);
			return textResult({ tripId, items: listSharesForTrip(tripId) });
		}
	},
	'roamarr_share_create': {
		scope: 'sharing:write',
		handler: async ({ userId, args }) => {
			if (typeof args.tripId !== 'number' || !Number.isSafeInteger(args.tripId) || args.tripId < 1) {
				return { content: [{ type: 'text' as const, text: 'tripId must be a positive integer' }], isError: true };
			}
			const { createShare } = await import('../repositories/tripsRepo');
			const { getUserByEmail } = await import('../repositories/usersRepo');
			const { normalizeEmail } = await import('../users');
			const tripId = args.tripId;
			requireOwnedTrip(userId, tripId);
			const parsed = parseShareArgs(args);
			if (!parsed.ok) return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
			const kind = String(args.kind);
			let sharedWithUserId: number | null = null;
			let sharedWithGroupId: number | null = null;
			if (kind === 'user') {
				const u = args.email ? getUserByEmail(normalizeEmail(String(args.email))) : null;
				if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
				sharedWithUserId = Number(u.id);
			} else if (kind === 'group') {
				const gid = Number(args.groupId);
				// IDOR: caller must own the group before sharing a trip to it.
				requireOwnedGroup(userId, gid);
				sharedWithGroupId = gid;
			} else if (kind === 'public') {
				// Public share mints a per-trip public token via the
				// existing helper. The web UI does the same.
				const { _mintPublicToken } = await import('../../../routes/trips/[id]/share/+page.server');
				const publicShowDetails = parsed.showDetails ?? false;
				const token = _mintPublicToken(userId, tripId, publicShowDetails, null);
				logAudit(userId, 'mcp_share_create', 'trip', tripId, { kind: 'public' });
				return textResult({ kind: 'public', tripId, publicToken: token });
			} else {
				return { content: [{ type: 'text' as const, text: `Unknown share kind: ${kind}` }], isError: true };
			}
			const share = createShare({
				tripId,
				sharedWithUserId,
				sharedWithGroupId,
				permission: parsed.permission ?? 'read',
				showDetails: parsed.showDetails ?? false
			});
			logAudit(userId, 'mcp_share_create', 'trip_share', share.id, { tripId });
			return textResult({ id: share.id, tripId });
		}
	},
	'roamarr_share_update': {
		scope: 'sharing:write',
		handler: async ({ userId, args }) => {
			const { updateShare, getShareById } = await import('../repositories/tripsRepo');
			if (typeof args.shareId !== 'number' || !Number.isSafeInteger(args.shareId) || args.shareId < 1) {
				return { content: [{ type: 'text' as const, text: 'shareId must be a positive integer' }], isError: true };
			}
			const id = args.shareId;
			const existing = getShareById(id);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
			requireOwnedTrip(userId, existing.tripId);
			const parsed = parseShareArgs(args);
			if (!parsed.ok) return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
			if (parsed.permission === undefined && parsed.showDetails === undefined) {
				return { content: [{ type: 'text' as const, text: 'provide permission or showDetails to update' }], isError: true };
			}
			const patch: { permission?: SharePermission; showDetails?: boolean } = {};
			if (parsed.permission !== undefined) patch.permission = parsed.permission;
			if (parsed.showDetails !== undefined) patch.showDetails = parsed.showDetails;
			const updated = updateShare(id, patch);
			if (!updated) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
			logAudit(userId, 'mcp_share_update', 'trip_share', id, {});
			return textResult({ ok: true, shareId: id });
		}
	},
	'roamarr_share_revoke': {
		scope: 'sharing:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteShare, getShareById } = await import('../repositories/tripsRepo');
			const id = Number(args.shareId);
			const existing = getShareById(id);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Share not found' }], isError: true };
			requireOwnedTrip(userId, existing.tripId);
			deleteShare(id);
			logAudit(userId, 'mcp_share_revoke', 'trip_share', id, {});
			return textResult({ ok: true, shareId: id });
		}
	},
	'roamarr_group_list': {
		scope: 'sharing:read',
		handler: async ({ userId }) => {
			const { listGroupsForUser } = await import('../sharing');
			return textResult({ items: listGroupsForUser(userId) });
		}
	},
	'roamarr_group_create': {
		scope: 'sharing:write',
		handler: async ({ userId, args }) => {
			const { createGroup } = await import('../repositories/tripsRepo');
			const g = createGroup({ ownerId: userId, name: String(args.name ?? '') });
			logAudit(userId, 'mcp_group_create', 'group', g.id, {});
			return textResult({ id: g.id, name: g.name });
		}
	},
	'roamarr_group_member_add': {
		scope: 'sharing:write',
		handler: async ({ userId, args }) => {
			const { addGroupMember } = await import('../repositories/tripsRepo');
			const { getUserByEmail } = await import('../repositories/usersRepo');
			const { normalizeEmail } = await import('../users');
			const { requireOwnedGroup } = await import('../ownership');
			const groupId = Number(args.groupId);
			// IDOR: caller must own the group.
			requireOwnedGroup(userId, groupId);
			const u = args.email ? getUserByEmail(normalizeEmail(String(args.email))) : null;
			if (!u) return { content: [{ type: 'text' as const, text: 'User not found' }], isError: true };
			addGroupMember(groupId, Number(u.id));
			logAudit(userId, 'mcp_group_member_add', 'group', groupId, { userId: Number(u.id) });
			return textResult({ ok: true, groupId, userId: Number(u.id) });
		}
	},
	'roamarr_group_member_remove': {
		scope: 'sharing:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { removeGroupMember } = await import('../repositories/tripsRepo');
			const { requireOwnedGroup } = await import('../ownership');
			const groupId = Number(args.groupId);
			// IDOR: caller must own the group.
			requireOwnedGroup(userId, groupId);
			const targetUserId = Number(args.userId);
			const n = removeGroupMember(groupId, targetUserId);
			if (n === 0) return { content: [{ type: 'text' as const, text: 'Member not in group' }], isError: true };
			logAudit(userId, 'mcp_group_member_remove', 'group', groupId, { userId: targetUserId });
			return textResult({ ok: true, groupId, userId: targetUserId });
		}
	},
	'roamarr_calendar_rotate_token': {
		scope: 'calendar:write',
		handler: async ({ userId, args }) => {
			const { regenerateCalendarToken } = await import('../../../routes/trips/shared');
			const tripId = Number(args.tripId);
			requireOwnedTrip(userId, tripId);
			regenerateCalendarToken(userId, tripId);
			logAudit(userId, 'mcp_calendar_rotate_token', 'trip', tripId, {});
			return textResult({ ok: true, tripId });
		}
	},
	'roamarr_contact_list': {
		scope: 'contacts:read',
		handler: async ({ userId }) => {
			const { listEmergencyContacts } = await import('../repositories/profileRepo');
			return textResult({ items: listEmergencyContacts(userId) });
		}
	},
	'roamarr_contact_create': {
		scope: 'contacts:write',
		handler: async ({ userId, args }) => {
			const { createEmergencyContact } = await import('../repositories/profileRepo');
			const c = createEmergencyContact(userId, {
				name: String(args.name ?? ''),
				relationship: (args.relationship as string) ?? null,
				phone: (args.phone as string) ?? null,
				email: (args.email as string) ?? null,
				isPrimary: Boolean(args.isPrimary)
			});
			logAudit(userId, 'mcp_contact_create', 'emergency_contact', c.id, {});
			return textResult({ id: c.id });
		}
	},
	'roamarr_contact_update': {
		scope: 'contacts:write',
		handler: async ({ userId, args }) => {
			const { updateEmergencyContact, getEmergencyContactById } = await import('../repositories/profileRepo');
			const id = Number(args.contactId);
			const existing = getEmergencyContactById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Contact not found' }], isError: true };
			// updateEmergencyContact is a full-row replace (it always sets
			// relationship/phone/email/isPrimary). Merge from existing so
			// omitted args preserve the current values instead of being
			// wiped to null / demoted from primary.
			updateEmergencyContact(id, userId, {
				name: (args.name as string) ?? existing.name,
				relationship: (args.relationship as string) ?? existing.relationship,
				phone: (args.phone as string) ?? existing.phone,
				email: (args.email as string) ?? existing.email,
				isPrimary: args.isPrimary == null ? existing.isPrimary : Boolean(args.isPrimary)
			});
			logAudit(userId, 'mcp_contact_update', 'emergency_contact', id, {});
			return textResult({ ok: true, contactId: id });
		}
	},
	'roamarr_contact_delete': {
		scope: 'contacts:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteEmergencyContact, getEmergencyContactById } = await import('../repositories/profileRepo');
			const id = Number(args.contactId);
			if (!getEmergencyContactById(id, userId)) return { content: [{ type: 'text' as const, text: 'Contact not found' }], isError: true };
			deleteEmergencyContact(id, userId);
			logAudit(userId, 'mcp_contact_delete', 'emergency_contact', id, {});
			return textResult({ ok: true, contactId: id });
		}
	},
};
