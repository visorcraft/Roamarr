<script lang="ts">
	import SecurityPage from '../security/+page.svelte';
	let { data, form } = $props();
	const pageData: any = $derived(data);
	const actionData: any = $derived(form);
</script>

<SecurityPage data={pageData} form={actionData} />
