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
	const describedBy = $derived(errorPairs.map((p) => p.id).join(' '));
</script>

<div class="field {wrapClass}">
	<label class="label" for={id}>{label}</label>
	<select
		{id}
		{name}
		{value}
		{required}
		{disabled}
		class={controlClass}
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={invalid ? describedBy : undefined}
		{...rest}
	>
		{@render children?.()}
	</select>
	{#each errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
