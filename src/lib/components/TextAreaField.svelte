<script lang="ts">
	import { resolveFieldAria } from '$lib/fieldAria';

	let {
		name,
		label,
		errors = {},
		errorKey = [name] as string | string[],
		value = undefined as unknown,
		rows = 4,
		placeholder = '',
		required = false,
		disabled = false,
		hint = '',
		id = name,
		class: wrapClass = '',
		...rest
	}: {
		name: string;
		label: string;
		errors?: Record<string, string>;
		errorKey?: string | string[];
		value?: unknown;
		rows?: number;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		hint?: string;
		id?: string;
		class?: string;
		[key: string]: unknown;
	} = $props();

	const aria = $derived(
		resolveFieldAria({ id, errors, errorKey, hint, describedBy: rest['aria-describedby'] })
	);
	const controlClass = $derived(`textarea ${aria.invalid ? 'input-error' : ''}`.trim());
</script>

<div class="field {wrapClass}">
	<label class="label" for={id}>{label}</label>
	<textarea
		{...rest}
		{id}
		{name}
		{rows}
		{placeholder}
		{required}
		{disabled}
		class={controlClass}
		aria-invalid={aria.invalid ? 'true' : undefined}
		aria-describedby={aria.describedBy}
	>{value as string | undefined}</textarea>
	{#if hint}<p class="field-help" id={aria.hintId}>{hint}</p>{/if}
	{#each aria.errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
