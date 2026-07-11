<script lang="ts">
	import ConfigurationPage from '../+page.svelte';
	let { data, form } = $props();
	const pageData: any = $derived(data);
	const actionData: any = $derived(form);
</script>

<ConfigurationPage data={pageData} form={actionData} />
