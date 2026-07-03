<script lang="ts">
	let {
		name,
		label,
		value = '',
		type = 'text',
		error = undefined,
		disabled = false,
		required = false,
		placeholder = '',
		autocomplete = undefined
	}: {
		name: string;
		label: string;
		value?: string | number;
		type?: string;
		error?: string | undefined;
		disabled?: boolean;
		required?: boolean;
		placeholder?: string;
		autocomplete?: string;
	} = $props();

	const inputClass = $derived(`input ${error ? 'input-error' : ''}`.trim());
	const errorId = $derived(`${name}-error`);
</script>

<div class="field">
	<label class="label" for={name}>
		{label}{#if required}<span aria-label="required"> *</span>{/if}
	</label>
	<input
		id={name}
		{name}
		{type}
		{value}
		{placeholder}
		{disabled}
		{required}
		autocomplete={autocomplete as any}
		class={inputClass}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
	/>
	{#if error}<p class="field-error" id={errorId}>{error}</p>{/if}
</div>
