<script lang="ts">
	let {
		name,
		label,
		errors = {},
		errorKey = [name] as string | string[],
		type = 'text',
		value = undefined as unknown,
		placeholder = '',
		required = false,
		disabled = false,
		hint = '',
		autocomplete = undefined,
		id = name,
		class: wrapClass = '',
		...rest
	}: {
		name: string;
		label: string;
		errors?: Record<string, string>;
		errorKey?: string | string[];
		type?: string;
		value?: unknown;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		hint?: string;
		autocomplete?: string;
		id?: string;
		class?: string;
		[key: string]: unknown;
	} = $props();

	const keys = $derived(Array.from(new Set(Array.isArray(errorKey) ? errorKey : [errorKey])));
	const errorPairs = $derived(
		keys.map((k) => ({ id: `${id}-${k}-error`, msg: errors[k] })).filter((p): p is { id: string; msg: string } => Boolean(p.msg))
	);
	const invalid = $derived(errorPairs.length > 0);
	const inputClass = $derived(`input ${invalid ? 'input-error' : ''}`.trim());
	// Tokens a caller forwards via aria-describedby come first and are never dropped.
	const foreignIds = $derived(String(rest['aria-describedby'] ?? '').split(/\s+/).filter(Boolean));
	const hintId = $derived(hint ? `${id}-hint` : undefined);
	const describedBy = $derived([...foreignIds, hintId, ...errorPairs.map((p) => p.id)].filter(Boolean).join(' '));
</script>

<div class="field {wrapClass}">
	<label class="label" for={id}>{label}</label>
	<input
		{...rest}
		{id}
		{name}
		{type}
		value={value as any}
		{placeholder}
		{required}
		{disabled}
		autocomplete={autocomplete as any}
		class={inputClass}
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={describedBy || undefined}
	/>
	{#if hint}<p class="field-help" id={hintId}>{hint}</p>{/if}
	{#each errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
