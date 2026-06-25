import type { TripExpenseView, TripExpenseSummary, Settlement } from './types';

export function summarizeTripExpenses(
	expenses: TripExpenseView[],
	companions: { id: number }[],
	baseCurrency = 'USD'
): TripExpenseSummary {
	const people: Array<'owner' | number> = ['owner', ...companions.map((c) => c.id)];
	const totalsByCurrency: Record<string, number> = {};
	let baseAmountTotal = 0;
	const balancesByCurrency: Record<string, Record<'owner' | number, number>> = {};

	for (const e of expenses) {
		totalsByCurrency[e.currency] = (totalsByCurrency[e.currency] ?? 0) + e.amount;
		baseAmountTotal += e.baseAmount;
		if (!balancesByCurrency[e.currency]) {
			const initial: Record<'owner' | number, number> = { owner: 0 };
			for (const c of companions) initial[c.id] = 0;
			balancesByCurrency[e.currency] = initial;
		}

		const payer: 'owner' | number = e.paidByCompanionId ?? 'owner';
		balancesByCurrency[e.currency][payer] += e.amount;

		const splitPeople: Array<'owner' | number> =
			e.splitAmong.length > 0 ? e.splitAmong : [payer];
		const count = splitPeople.length;
		const baseShare = Math.floor(e.amount / count);
		const remainder = e.amount % count;

		for (let i = 0; i < splitPeople.length; i++) {
			const person = splitPeople[i];
			const share = baseShare + (i < remainder ? 1 : 0);
			balancesByCurrency[e.currency][person] -= share;
		}
	}

	const perPersonShareByCurrency: Record<string, number> = {};
	const peopleCount = people.length;
	for (const [currency, total] of Object.entries(totalsByCurrency)) {
		perPersonShareByCurrency[currency] = Math.round(total / peopleCount);
	}

	return {
		totalsByCurrency,
		baseTotal: expenses.length ? { currency: baseCurrency, amount: baseAmountTotal } : null,
		perPersonShareByCurrency,
		balancesByCurrency
	};
}

export function computeSettlement(
	expenses: TripExpenseView[],
	companions: { id: number; name: string }[]
): Record<string, Settlement> {
	const summary = summarizeTripExpenses(expenses, companions);
	const names = new Map<number, string>(companions.map((c) => [c.id, c.name]));
	const result: Record<string, Settlement> = {};

	for (const [currency, balances] of Object.entries(summary.balancesByCurrency)) {
		const settlementBalances: Settlement['balances'] = [];
		const creditors: Array<{ id: 'owner' | number; net: number }> = [];
		const debtors: Array<{ id: 'owner' | number; net: number }> = [];

		for (const [person, net] of Object.entries(balances)) {
			const id: 'owner' | number = person === 'owner' ? 'owner' : Number(person);
			const name = id === 'owner' ? 'You' : (names.get(id) ?? 'Unknown');
			settlementBalances.push({ companionId: id, name, net });
			if (net > 0) creditors.push({ id, net });
			else if (net < 0) debtors.push({ id, net: -net });
		}

		const payments: Settlement['payments'] = [];
		let i = 0;
		let j = 0;
		while (i < debtors.length && j < creditors.length) {
			const amount = Math.min(debtors[i].net, creditors[j].net);
			payments.push({ from: debtors[i].id, to: creditors[j].id, amount });
			debtors[i].net -= amount;
			creditors[j].net -= amount;
			if (debtors[i].net === 0) i++;
			if (creditors[j].net === 0) j++;
		}

		result[currency] = { balances: settlementBalances, payments };
	}

	return result;
}
