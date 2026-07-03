<script lang="ts">
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
		id?: string;
		class?: string;
		[key: string]: unknown;
	} = $props();

	const keys = $derived(Array.from(new Set(Array.isArray(errorKey) ? errorKey : [errorKey])));
	const errorPairs = $derived(
		keys.map((k) => ({ id: `${id}-${k}-error`, msg: errors[k] })).filter((p): p is { id: string; msg: string } => Boolean(p.msg))
	);
	const invalid = $derived(errorPairs.length > 0);
	const controlClass = $derived(`textarea ${invalid ? 'input-error' : ''}`.trim());
	const describedBy = $derived(errorPairs.map((p) => p.id).join(' '));
</script>

<div class="field {wrapClass}">
	<label class="label" for={id}>{label}</label>
	<textarea
		{id}
		{name}
		{rows}
		{placeholder}
		{required}
		{disabled}
		class={controlClass}
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={invalid ? describedBy : undefined}
		{...rest}
	>{value as string | undefined}</textarea>
	{#each errorPairs as p (p.id)}
		<p class="field-error" id={p.id}>{p.msg}</p>
	{/each}
</div>
