import { eq, and, desc, asc, inList } from '@visorcraft/mongreldb-kit';
import { error } from '@sveltejs/kit';
import { kit } from '../db';
import { cards, cardBenefits } from '../db/mongrelSchema';
import { sanitizeLast4 } from '../validation';
import { compareRows } from '../sortUtils';
import type { Row, Insert, Update } from '@visorcraft/mongreldb-kit';
import { toBigInt, idFromBigInt, optionalBigInt, optionalNumber, nullableText } from './kitHelpers';

// ============================================================================
// Cards
// ============================================================================

export type CardNetwork = 'visa' | 'mc' | 'amex' | 'disc' | 'other';

export interface Card {
	id: number;
	userId: number;
	nickname: string;
	network: CardNetwork;
	last4: string | null;
	notes: string | null;
}

export interface CardInput {
	nickname: string;
	network: string;
	last4?: string | null;
	notes?: string | null;
}

function toCard(row: Row<typeof cards>): Card {
	return {
		id: idFromBigInt(row.id),
		userId: idFromBigInt(row.user_id),
		nickname: row.nickname,
		network: row.network as CardNetwork,
		last4: nullableText(row.last4),
		notes: nullableText(row.notes)
	};
}

function toKitCardInput(input: CardInput): Update<typeof cards> {
	return {
		nickname: input.nickname.trim(),
		network: input.network,
		last4: sanitizeLast4(input.last4 ?? undefined),
		notes: input.notes?.trim() || null
	};
}




export function listCards(userId: number): Card[] {
	const rows = kit
		.selectFrom(cards)
		.where(eq(cards.user_id, toBigInt(userId)))
		.orderBy(desc(cards.id))
		
		.executeSync();
	return rows.map(toCard);
}

export interface ListCardsOptions {
	search?: string;
	sortBy?: 'nickname' | 'network' | 'last4';
	sortDir?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export function listCardsPaginated(userId: number, opts: ListCardsOptions = {}): Card[] {
	let rows = listCards(userId);
	const q = opts.search?.trim().toLowerCase();
	if (q) {
		rows = rows.filter(
			(c) =>
				c.nickname.toLowerCase().includes(q) ||
				c.network.toLowerCase().includes(q) ||
				(c.last4?.toLowerCase().includes(q) ?? false)
		);
	}
	const sortBy = opts.sortBy ?? 'nickname';
	const sortDir = opts.sortDir ?? 'asc';
	rows = rows.slice().sort((a, b) => compareRows(a, b, sortBy, sortDir));
	const offset = opts.offset ?? 0;
	const limit = opts.limit ?? rows.length;
	return rows.slice(offset, offset + limit);
}

export function countCards(userId: number, search?: string): number {
	if (!search?.trim()) {
		return Number(
			kit
				.selectFrom(cards)
				.where(eq(cards.user_id, toBigInt(userId)))
				.selectCount()
				.executeSync()
		);
	}
	const q = search.trim().toLowerCase();
	return listCards(userId).filter(
		(c) =>
			c.nickname.toLowerCase().includes(q) ||
			c.network.toLowerCase().includes(q) ||
			(c.last4?.toLowerCase().includes(q) ?? false)
	).length;
}

export function getCardById(id: number, userId: number): Card | null {
	const rows = kit
		.selectFrom(cards)
		.where(and(eq(cards.id, toBigInt(id)), eq(cards.user_id, toBigInt(userId))))
		.executeSync();
	return rows[0] ? toCard(rows[0]) : null;
}

export function createCard(userId: number, input: CardInput): Card {
	const row = kit
		.insertInto(cards)
		.values({
			user_id: toBigInt(userId),
			...toKitCardInput(input)
		} as Insert<typeof cards>)
		.executeSync();
	return toCard(row);
}

export function updateCard(id: number, userId: number, input: CardInput): Card | null {
	const existing = getCardById(id, userId);
	if (!existing) throw error(404, 'Not found');
	const rows = kit
		.updateTable(cards)
		.set(toKitCardInput(input))
		.where(and(eq(cards.id, toBigInt(id)), eq(cards.user_id, toBigInt(userId))))
		.executeSync();
	const updated = rows[0] ? toCard(rows[0]) : null;
	return updated;
}

export function deleteCard(id: number, userId: number): bigint {
	const existing = getCardById(id, userId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(cards)
		.where(eq(cards.id, toBigInt(id)))
		.executeSync();
}

// ============================================================================
// Card benefits
// ============================================================================

export type BenefitType = 'trip_delay' | 'baggage_delay' | 'trip_cancellation' | 'other';

export interface CardBenefit {
	id: number;
	cardId: number;
	benefitType: BenefitType;
	coverageAmount: number | null;
	currency: string;
	notes: string | null;
}

export interface CardBenefitInput {
	benefitType: string;
	coverageAmount?: number | null;
	currency?: string | null;
	notes?: string | null;
}

function toCardBenefit(row: Row<typeof cardBenefits>): CardBenefit {
	return {
		id: idFromBigInt(row.id),
		cardId: idFromBigInt(row.card_id),
		benefitType: row.benefit_type as BenefitType,
		coverageAmount: optionalNumber(row.coverage_amount),
		currency: row.currency,
		notes: nullableText(row.notes)
	};
}

function toKitCardBenefitInput(
	input: CardBenefitInput
): Update<typeof cardBenefits> {
	return {
		benefit_type: input.benefitType,
		coverage_amount: optionalBigInt(input.coverageAmount),
		currency: input.currency ?? 'USD',
		notes: input.notes?.trim() || null
	};
}




function requireOwnedCard(userId: number, cardId: number): Card {
	const card = getCardById(cardId, userId);
	if (!card) throw error(404, 'Not found');
	return card;
}

export function listBenefitsForCard(cardId: number): CardBenefit[] {
	const rows = kit
		.selectFrom(cardBenefits)
		.where(eq(cardBenefits.card_id, toBigInt(cardId)))
		.orderBy(asc(cardBenefits.id))
		
		.executeSync();
	return rows.map(toCardBenefit);
}

export function listBenefitsForCards(cardIds: number[]): CardBenefit[] {
	if (cardIds.length === 0) return [];
	const rows = kit
		.selectFrom(cardBenefits)
		.where(inList(cardBenefits.card_id, cardIds.map(toBigInt)))
		.executeSync();
	return rows.map(toCardBenefit);
}

export function getCardBenefitById(id: number, cardId: number): CardBenefit | null {
	const rows = kit
		.selectFrom(cardBenefits)
		.where(
			and(
				eq(cardBenefits.id, toBigInt(id)),
				eq(cardBenefits.card_id, toBigInt(cardId))
			)
		)
		.executeSync();
	return rows[0] ? toCardBenefit(rows[0]) : null;
}

export function createCardBenefit(
	userId: number,
	cardId: number,
	input: CardBenefitInput
): CardBenefit {
	requireOwnedCard(userId, cardId);
	const row = kit
		.insertInto(cardBenefits)
		.values({
			card_id: toBigInt(cardId),
			...toKitCardBenefitInput(input)
		} as Insert<typeof cardBenefits>)
		.executeSync();
	return toCardBenefit(row);
}

export function updateCardBenefit(
	id: number,
	cardId: number,
	input: CardBenefitInput
): CardBenefit | null {
	const existing = getCardBenefitById(id, cardId);
	if (!existing) throw error(404, 'Not found');
	const rows = kit
		.updateTable(cardBenefits)
		.set(toKitCardBenefitInput(input))
		.where(
			and(
				eq(cardBenefits.id, toBigInt(id)),
				eq(cardBenefits.card_id, toBigInt(cardId))
			)
		)
		.executeSync();
	const updated = rows[0] ? toCardBenefit(rows[0]) : null;
	return updated;
}

export function deleteCardBenefit(id: number, cardId: number): bigint {
	const existing = getCardBenefitById(id, cardId);
	if (!existing) throw error(404, 'Not found');
	return kit
		.deleteFrom(cardBenefits)
		.where(
			and(
				eq(cardBenefits.id, toBigInt(id)),
				eq(cardBenefits.card_id, toBigInt(cardId))
			)
		)
		.executeSync();
}

