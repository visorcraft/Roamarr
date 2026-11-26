export interface FieldErrorPair {
	id: string;
	msg: string;
}

export interface FieldAriaState {
	errorPairs: FieldErrorPair[];
	invalid: boolean;
	hintId: string | undefined;
	describedBy: string | undefined;
}

export function resolveFieldAria(opts: {
	id: string;
	errors?: Record<string, string>;
	errorKey: string | string[];
	hint?: string;
	describedBy?: unknown;
}): FieldAriaState {
	const keys = Array.from(new Set(Array.isArray(opts.errorKey) ? opts.errorKey : [opts.errorKey]));
	const errorPairs = keys
		.map((k) => ({ id: `${opts.id}-${k}-error`, msg: opts.errors?.[k] }))
		.filter((p): p is FieldErrorPair => Boolean(p.msg));
	const invalid = errorPairs.length > 0;
	const foreignIds = String(opts.describedBy ?? '')
		.split(/\s+/)
		.filter(Boolean);
	const hintId = opts.hint ? `${opts.id}-hint` : undefined;
	const describedBy =
		[...foreignIds, hintId, ...errorPairs.map((p) => p.id)].filter(Boolean).join(' ') || undefined;
	return { errorPairs, invalid, hintId, describedBy };
}
