import { expect, test } from 'vitest';
import { parseCardBenefit } from './mobileCardBenefits';

test('parses valid card benefits', () => {
	expect(parseCardBenefit({ benefitType: 'trip_delay', coverageAmount: '50000', currency: 'usd', notes: ' Coverage ' })).toEqual({ benefitType: 'trip_delay', coverageAmount: 50000, currency: 'USD', notes: 'Coverage' });
});

test.each([
	{ benefitType: 'bad' },
	{ benefitType: 'trip_delay', coverageAmount: 1.5 },
	{ benefitType: 'trip_delay', coverageAmount: -1 },
	{ benefitType: 'trip_delay', currency: 'dollars' }
])('rejects invalid card benefit %#', (input) => {
	expect(() => parseCardBenefit(input)).toThrow();
});
