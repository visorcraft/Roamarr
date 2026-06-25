<script lang="ts">
	export let name: string;
	export let label: string;
	export let value: string | number = '';
	export let type = 'text';
	export let error: string | undefined = undefined;
	export let disabled = false;
	export let required = false;
	export let placeholder = '';
	export let autocomplete: string | undefined = undefined;

	$: inputClass = `input ${error ? 'input-error' : ''}`.trim();
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
		on:input
	/>
	{#if error}<p class="field-error" id="{name}-error">{error}</p>{/if}
</div>
