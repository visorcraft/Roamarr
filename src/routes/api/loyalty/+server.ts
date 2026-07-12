import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseTableParams } from '$lib/tableParams';
import { requireUser } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rateLimit';
import {
	listLoyaltyProgramsPaginated,
	countLoyaltyPrograms, createLoyaltyProgram
} from '$lib/server/repositories/profileRepo';
import { Validator } from '$lib/server/validation';
import { logAudit } from '$lib/server/audit';

export const GET: RequestHandler = async ({ url, locals, getClientAddress }) => {
	const u = requireUser(locals);
	const limit = checkRateLimit(getClientAddress(), 'api:loyalty:list');
	if (!limit.allowed) throw error(429, 'Too many requests');
	const { page, limit: pageLimit, search, sort, dir } = parseTableParams(url, [
		'programName',
		'membershipNumber',
		'balance',
		'balanceUpdatedAt'
	]);
	const offset = (page - 1) * pageLimit;
	const rows = listLoyaltyProgramsPaginated(u.id, {
		search,
		sortBy: sort as 'programName' | 'membershipNumber' | 'balance' | 'balanceUpdatedAt' | undefined,
		sortDir: dir,
		limit: pageLimit,
		offset
	});
	const total = countLoyaltyPrograms(u.id, search);
	return json({
		rows: rows.map((p) => ({
			id: p.id,
			programName: p.programName,
			membershipNumber: p.membershipNumber,
			balance: p.balance,
			notes: p.notes,
			balanceUpdatedAt: p.balanceUpdatedAt
		})),
		total
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals), body = await request.json() as Record<string, unknown>, validator = new Validator();
	const programName = validator.requiredString(body.programName, 'programName', { max: 200 });
	const membershipNumber = validator.optionalString(body.membershipNumber, 'membershipNumber', { max: 200 }), notes = validator.optionalString(body.notes, 'notes', { max: 2000 });
	const balance = body.balance == null || body.balance === '' ? undefined : Number(body.balance);
	if (balance != null && (!Number.isFinite(balance) || balance < 0)) validator.addError('balance', 'Balance must be non-negative');
	if (!validator.ok()) return json({ error: validator.failMessage(), errors: validator.errors }, { status: 400 });
	const program = createLoyaltyProgram(user.id, { programName: programName!, membershipNumber, balance, notes });
	logAudit(user.id, 'loyalty_program_create', 'loyalty_program', program.id);
	return json({ program }, { status: 201 });
};
