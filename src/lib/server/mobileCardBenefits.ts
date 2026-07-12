import { error } from '@sveltejs/kit';
import { currency } from './validation';
import type { CardBenefitInput } from './repositories/profileRepo';

const TYPES = new Set(['trip_delay', 'baggage_delay', 'trip_cancellation', 'other']);

export function parseCardBenefit(body: Record<string, unknown>): CardBenefitInput {
	const benefitType = String(body.benefitType ?? '');
	if (!TYPES.has(benefitType)) throw error(400, 'Invalid benefit type');
	const coverageAmount = body.coverageAmount == null || body.coverageAmount === '' ? null : Number(body.coverageAmount);
	if (coverageAmount != null && (!Number.isSafeInteger(coverageAmount) || coverageAmount < 0)) throw error(400, 'Coverage amount must be a non-negative integer');
	const parsedCurrency = currency(String(body.currency ?? 'USD'), 'currency');
	if (!parsedCurrency.ok) throw error(400, parsedCurrency.error);
	const notes = String(body.notes ?? '').trim();
	if (notes.length > 2000) throw error(400, 'Notes must be 2000 characters or fewer');
	return { benefitType, coverageAmount, currency: parsedCurrency.value, notes: notes || null };
}
