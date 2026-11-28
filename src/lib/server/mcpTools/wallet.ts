import type { McpToolModule } from './context';
import { requireEditableTrip } from '../ownership';
import { requireViewableTrip } from '../ownership';
import { logAudit } from '../audit';
import type { TravelDocumentType } from '../db/mongrelSchema';
import { projectCard } from '../mcpHelpers';
import { projectLoyalty } from '../mcpHelpers';
import { projectInsurance } from '../mcpHelpers';
import { projectTravelDocument } from '../mcpHelpers';
import { paginateList } from '../mcpHelpers';
import { textResult } from './context';

export const walletTools: McpToolModule = {
	'roamarr_card_list': {
		scope: 'cards:read',
		handler: async ({ userId, args }) => {
			const { listCards } = await import('../repositories/profileRepo');
			const cards = listCards(userId);
			const page = paginateList(cards, args, (c) => c.id);
			return textResult({
				items: page.items.map((c) => projectCard(c)),
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_card_create': {
		scope: 'cards:write',
		handler: async ({ userId, args }) => {
			const { createCard } = await import('../repositories/profileRepo');
			// last4 must be exactly 4 digits. The MCP interface is
			// last4-only; never pass a full PAN.
			const last4Raw = String(args.last4 ?? '');
			if (!/^\d{4}$/.test(last4Raw)) {
				return { content: [{ type: 'text' as const, text: 'last4 must be exactly 4 digits' }], isError: true };
			}
			const c = createCard(userId, { network: String(args.network), last4: last4Raw, nickname: String(args.label ?? '') });
			logAudit(userId, 'mcp_card_create', 'card', c.id, {});
			return textResult({ id: c.id });
		}
	},
	'roamarr_card_update': {
		scope: 'cards:write',
		handler: async ({ userId, args }) => {
			const { updateCard, getCardById } = await import('../repositories/profileRepo');
			const id = Number(args.cardId);
			const existing = getCardById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Card not found' }], isError: true };
			// updateCard is a full-row replace; carry over notes so a
			// partial update (e.g. renaming) does not wipe them.
			updateCard(id, userId, {
				network: existing.network,
				last4: existing.last4,
				nickname: String(args.label ?? existing.nickname),
				notes: existing.notes
			});
			logAudit(userId, 'mcp_card_update', 'card', id, {});
			return textResult({ ok: true, cardId: id });
		}
	},
	'roamarr_card_delete': {
		scope: 'cards:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteCard, getCardById } = await import('../repositories/profileRepo');
			const id = Number(args.cardId);
			if (!getCardById(id, userId)) return { content: [{ type: 'text' as const, text: 'Card not found' }], isError: true };
			deleteCard(id, userId);
			logAudit(userId, 'mcp_card_delete', 'card', id, {});
			return textResult({ ok: true, cardId: id });
		}
	},
	'roamarr_loyalty_list': {
		scope: 'loyalty:read',
		handler: async ({ userId, args }) => {
			const { listLoyaltyPrograms } = await import('../repositories/profileRepo');
			const programs = listLoyaltyPrograms(userId);
			const page = paginateList(programs, args, (l) => l.id);
			return textResult({
				items: page.items.map((l) => projectLoyalty(l)),
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_loyalty_create': {
		scope: 'loyalty:write',
		handler: async ({ userId, args }) => {
			const { createLoyaltyProgram } = await import('../repositories/profileRepo');
			const l = createLoyaltyProgram(userId, {
				programName: String(args.programName ?? ''),
				membershipNumber: (args.memberNumber as string) ?? null
			});
			logAudit(userId, 'mcp_loyalty_create', 'loyalty_program', l.id, {});
			return textResult({ id: l.id });
		}
	},
	'roamarr_loyalty_update': {
		scope: 'loyalty:write',
		handler: async ({ userId, args }) => {
			const { updateLoyaltyProgram, getLoyaltyProgramById } = await import('../repositories/profileRepo');
			const id = Number(args.loyaltyId);
			const existing = getLoyaltyProgramById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Loyalty program not found' }], isError: true };
			// updateLoyaltyProgram is a full-row replace; carry over
			// balance and notes so a partial update does not wipe the
			// tracked points balance or reset balance_updated_at.
			updateLoyaltyProgram(id, userId, {
				programName: (args.programName as string) ?? existing.programName,
				membershipNumber: (args.memberNumber as string) ?? existing.membershipNumber,
				balance: existing.balance,
				notes: existing.notes
			});
			logAudit(userId, 'mcp_loyalty_update', 'loyalty_program', id, {});
			return textResult({ ok: true, loyaltyId: id });
		}
	},
	'roamarr_loyalty_delete': {
		scope: 'loyalty:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteLoyaltyProgram, getLoyaltyProgramById } = await import('../repositories/profileRepo');
			const id = Number(args.loyaltyId);
			if (!getLoyaltyProgramById(id, userId)) return { content: [{ type: 'text' as const, text: 'Loyalty program not found' }], isError: true };
			deleteLoyaltyProgram(id, userId);
			logAudit(userId, 'mcp_loyalty_delete', 'loyalty_program', id, {});
			return textResult({ ok: true, loyaltyId: id });
		}
	},
	'roamarr_insurance_list': {
		scope: 'insurance:read',
		handler: async ({ userId, args }) => {
			const { listInsurancePolicies } = await import('../repositories/profileRepo');
			const policies = listInsurancePolicies(userId);
			const page = paginateList(policies, args, (p) => p.id);
			return textResult({
				items: page.items.map((p) => projectInsurance(p)),
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_insurance_create': {
		scope: 'insurance:write',
		handler: async ({ userId, args }) => {
			const { createInsurancePolicy } = await import('../repositories/profileRepo');
			const p = createInsurancePolicy(userId, {
				provider: String(args.provider ?? ''),
				policyNumber: (args.policyNumber as string) ?? null,
				coverageSummary: (args.coverageType as string) ?? null,
				notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_insurance_create', 'insurance_policy', p.id, {});
			return textResult({ id: p.id });
		}
	},
	'roamarr_insurance_update': {
		scope: 'insurance:write',
		handler: async ({ userId, args }) => {
			const { updateInsurancePolicy, getInsurancePolicyById } = await import('../repositories/profileRepo');
			const id = Number(args.insuranceId);
			const existing = getInsurancePolicyById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Insurance not found' }], isError: true };
			// updateInsurancePolicy is a full-row replace; carry over
			// coverage / date / trip linkage so a partial update does
			// not silently wipe coverage details or detach the policy.
			updateInsurancePolicy(id, userId, {
				provider: (args.provider as string) ?? existing.provider,
				policyNumber: (args.policyNumber as string) ?? existing.policyNumber ?? null,
				coverageSummary: existing.coverageSummary,
				coverageAmount: existing.coverageAmount,
				currency: existing.currency,
				startDate: existing.startDate,
				endDate: existing.endDate,
				tripId: existing.tripId,
				notes: (args.notes as string) ?? existing.notes ?? null
			});
			logAudit(userId, 'mcp_insurance_update', 'insurance_policy', id, {});
			return textResult({ ok: true, insuranceId: id });
		}
	},
	'roamarr_insurance_delete': {
		scope: 'insurance:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteInsurancePolicy, getInsurancePolicyById } = await import('../repositories/profileRepo');
			const id = Number(args.insuranceId);
			if (!getInsurancePolicyById(id, userId)) return { content: [{ type: 'text' as const, text: 'Insurance not found' }], isError: true };
			deleteInsurancePolicy(id, userId);
			logAudit(userId, 'mcp_insurance_delete', 'insurance_policy', id, {});
			return textResult({ ok: true, insuranceId: id });
		}
	},
	'roamarr_travel_doc_list': {
		scope: 'travel-docs:read',
		handler: async ({ userId, args }) => {
			const { listTravelDocuments } = await import('../repositories/profileRepo');
			const docs = listTravelDocuments(userId);
			const page = paginateList(docs, args, (d) => d.id);
			return textResult({
				items: page.items.map((d) => projectTravelDocument(d)),
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_travel_doc_create': {
		scope: 'travel-docs:write',
		handler: async ({ userId, args }) => {
			const { createTravelDocument } = await import('../repositories/profileRepo');
			const d = createTravelDocument(userId, {
				type: String(args.type) as TravelDocumentType,
				issuingAuthority: (args.issuer as string) ?? null,
				number: (args.number as string) ?? null,
				expiresOn: (args.expiresOn as string) ?? null
			});
			logAudit(userId, 'mcp_travel_doc_create', 'travel_document', d.id, {});
			return textResult({ id: d.id });
		}
	},
	'roamarr_travel_doc_update': {
		scope: 'travel-docs:write',
		handler: async ({ userId, args }) => {
			const { updateTravelDocument, getTravelDocumentById } = await import('../repositories/profileRepo');
			const id = Number(args.docId);
			const existing = getTravelDocumentById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true };
			// updateTravelDocument is a full-row replace; carry over
			// notes and companionId so a partial update does not wipe
			// user notes or detach the document from its companion.
			updateTravelDocument(id, userId, {
				type: existing.type,
				issuingAuthority: (args.issuer as string) ?? existing.issuingAuthority,
				number: (args.number as string) ?? existing.number,
				expiresOn: (args.expiresOn as string) ?? existing.expiresOn,
				notes: existing.notes,
				companionId: existing.companionId
			});
			logAudit(userId, 'mcp_travel_doc_update', 'travel_document', id, {});
			return textResult({ ok: true, docId: id });
		}
	},
	'roamarr_travel_doc_delete': {
		scope: 'travel-docs:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteTravelDocument, getTravelDocumentById } = await import('../repositories/profileRepo');
			const id = Number(args.docId);
			if (!getTravelDocumentById(id, userId)) return { content: [{ type: 'text' as const, text: 'Document not found' }], isError: true };
			deleteTravelDocument(id, userId);
			logAudit(userId, 'mcp_travel_doc_delete', 'travel_document', id, {});
			return textResult({ ok: true, docId: id });
		}
	},
	'roamarr_doc_link_list': {
		scope: 'doc-links:read',
		handler: async ({ userId, args }) => {
			const { listDocumentLinksForTrip } = await import('../repositories/tripMiscRepo');
			const tripId = Number(args.tripId);
			requireViewableTrip(userId, tripId);
			const links = listDocumentLinksForTrip(tripId);
			const page = paginateList(links, args, (l) => l.id);
			return textResult({
				tripId,
				items: page.items,
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_doc_link_create': {
		scope: 'doc-links:write',
		handler: async ({ userId, args }) => {
			const { createDocumentLink } = await import('../tripDocumentLinks');
			const tripId = Number(args.tripId);
			// Helper enforces ownership + URL validation + audit log.
			const link = createDocumentLink(userId, tripId, {
				label: String(args.label ?? ''),
				url: String(args.url ?? ''),
				notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_doc_link_create', 'trip_document_link', link.id, { tripId });
			return textResult({ id: link.id, tripId });
		}
	},
	'roamarr_doc_link_update': {
		scope: 'doc-links:write',
		handler: async ({ userId, args }) => {
			const { editDocumentLink } = await import('../tripDocumentLinks');
			const { getDocumentLinkById } = await import('../repositories/tripMiscRepo');
			const id = Number(args.linkId);
			if (!Number.isSafeInteger(id) || id <= 0) {
				return { content: [{ type: 'text' as const, text: 'linkId must be a positive integer' }], isError: true };
			}
			const existing = getDocumentLinkById(id);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
			editDocumentLink(userId, existing.tripId, id, {
				label: String(args.label ?? existing.label),
				url: String(args.url ?? existing.url),
				notes: args.notes === undefined ? (existing.notes ?? null) : args.notes === null ? null : String(args.notes)
			});
			logAudit(userId, 'mcp_doc_link_update', 'trip_document_link', id, {});
			return textResult({ ok: true, linkId: id });
		}
	},
	'roamarr_doc_link_delete': {
		scope: 'doc-links:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteDocumentLink, getDocumentLinkById } = await import('../repositories/tripMiscRepo');
			const id = Number(args.linkId);
			const existing = getDocumentLinkById(id);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
			requireEditableTrip(userId, existing.tripId);
			deleteDocumentLink(id);
			logAudit(userId, 'mcp_doc_link_delete', 'trip_document_link', id, {});
			return textResult({ ok: true, linkId: id });
		}
	},
};
