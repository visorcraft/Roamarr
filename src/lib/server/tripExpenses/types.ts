// Internal types used by tripExpenses/repository.ts and tripExpenses/summaries.ts.
// They are intentionally not re-exported from the tripExpenses barrel.
export interface TripExpenseView {
	id: number;
	tripId: number;
	description: string;
	amount: number;
	currency: string;
	category: string | null;
	exchangeRate: number;
	baseAmount: number;
	paidByCompanionId: number | null;
	paidBy: 'owner' | number;
	splitAmong: Array<'owner' | number>;
	createdAt: string;
}

export interface TripExpenseSummary {
	totalsByCurrency: Record<string, number>;
	baseTotal: { currency: string; amount: number } | null;
	perPersonShareByCurrency: Record<string, number>;
	balancesByCurrency: Record<string, Record<'owner' | number, number>>;
}

export interface Settlement {
	balances: Array<{ companionId: 'owner' | number; name: string; net: number }>;
	payments: Array<{ from: 'owner' | number; to: 'owner' | number; amount: number }>;
}
