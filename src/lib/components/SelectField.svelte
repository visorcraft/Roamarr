<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolveFieldAria } from '$lib/fieldAria';

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

	const aria = $derived(
		resolveFieldAria({ id, errors, errorKey, hint, describedBy: rest['aria-describedby'] })
	);
	const controlClass = $derived(`input ${aria.invalid ? 'input-error' : ''}`.trim());
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
		aria-invalid={aria.invalid ? 'true' : undefined}
		aria-describedby={aria.describedBy}
	>
		{@render children?.()}
	</select>
	{#if hint}<p class="field-help" id={aria.hintId}>{hint}</p>{/if}
	{#each aria.errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
