<script lang="ts">
	export let name: string;
	export let label: string;
	export let value: string = '';
	export let error: string | undefined = undefined;
	export let disabled = false;
	export let required = false;
	export let placeholder = '';
	export let rows = 3;

	$: textareaClass = `textarea ${error ? 'input-error' : ''}`.trim();
</script>

<div class="field">
	<label class="label" for={name}>
		{label}{#if required}<span aria-label="required"> *</span>{/if}
	</label>
	<textarea
		id={name}
		{name}
		{value}
		{placeholder}
		{disabled}
		{required}
		{rows}
		class={textareaClass}
		on:input
	></textarea>
	{#if error}<p class="field-error" id="{name}-error">{error}</p>{/if}
</div>
