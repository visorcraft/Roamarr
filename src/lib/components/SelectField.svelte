<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		name,
		label,
		errors = {},
		errorKey = [name] as string | string[],
		value = undefined as unknown,
		required = false,
		disabled = false,
		hint = '',
		id = name,
		class: wrapClass = '',
		children,
		...rest
	}: {
		name: string;
		label: string;
		errors?: Record<string, string>;
		errorKey?: string | string[];
		value?: unknown;
		required?: boolean;
		disabled?: boolean;
		hint?: string;
		id?: string;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	} = $props();

	const keys = $derived(Array.from(new Set(Array.isArray(errorKey) ? errorKey : [errorKey])));
	const errorPairs = $derived(
		keys.map((k) => ({ id: `${id}-${k}-error`, msg: errors[k] })).filter((p): p is { id: string; msg: string } => Boolean(p.msg))
	);
	const invalid = $derived(errorPairs.length > 0);
	const controlClass = $derived(`input ${invalid ? 'input-error' : ''}`.trim());
	// Tokens a caller forwards via aria-describedby come first and are never dropped.
	const foreignIds = $derived(String(rest['aria-describedby'] ?? '').split(/\s+/).filter(Boolean));
	const hintId = $derived(hint ? `${id}-hint` : undefined);
	const describedBy = $derived([...foreignIds, hintId, ...errorPairs.map((p) => p.id)].filter(Boolean).join(' '));
</script>

<div class="field {wrapClass}">
	<label class="label" for={id}>{label}</label>
	<select
		{...rest}
		{id}
		{name}
		{value}
		{required}
		{disabled}
		class={controlClass}
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={describedBy || undefined}
	>
		{@render children?.()}
	</select>
	{#if hint}<p class="field-help" id={hintId}>{hint}</p>{/if}
	{#each errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
