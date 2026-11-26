<script lang="ts">
	import { resolveFieldAria } from '$lib/fieldAria';

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

	const aria = $derived(
		resolveFieldAria({ id, errors, errorKey, hint, describedBy: rest['aria-describedby'] })
	);
	const inputClass = $derived(`input ${aria.invalid ? 'input-error' : ''}`.trim());
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
		aria-invalid={aria.invalid ? 'true' : undefined}
		aria-describedby={aria.describedBy}
	/>
	{#if hint}<p class="field-help" id={aria.hintId}>{hint}</p>{/if}
	{#each aria.errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
