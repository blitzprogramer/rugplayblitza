<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Switch } from '$lib/components/ui/switch';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		ArrowUpDownIcon,
		Add01Icon,
		Settings01Icon,
		Loading03Icon,
		Cancel01Icon,
		Tick01Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import { formatValue, formatRelativeTime } from '$lib/utils';

	type Status = 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
	interface HopiumQuestion {
		id: number;
		question: string;
		status: Status;
		resolutionDate: string;
		aiResolution: boolean | null;
		aiConfidence: number | null;
		aiReasoning: string | null;
		totalYes: number;
		totalNo: number;
		betCount: number;
		createdAt: string;
		resolvedAt: string | null;
	}
	interface HopiumSettings {
		autogenerate: boolean;
		targetCount: number;
	}

	let questions = $state<HopiumQuestion[]>([]);
	let loading = $state(true);
	let statusFilter = $state<Status | 'ALL'>('ALL');
	let search = $state('');

	let settings = $state<HopiumSettings>({ autogenerate: true, targetCount: 25 });
	let settingsLoading = $state(true);
	let savingSettings = $state(false);
	let targetInput = $state('25');

	// Action dialog state
	type DialogMode = 'resolve' | 'reverse' | 'cancel' | 'edit' | 'create';
	let dialogMode = $state<DialogMode | null>(null);
	let dialogOpen = $state(false);
	let dialogQuestion = $state<HopiumQuestion | null>(null);
	let dialogResolution = $state(true); // true=YES, false=NO
	let dialogReasoning = $state('');
	let dialogText = $state('');
	let dialogDate = $state('');
	let dialogWebSearch = $state(false);
	let submitting = $state(false);

	async function loadQuestions() {
		loading = true;
		try {
			const params = new URLSearchParams();
			if (statusFilter !== 'ALL') params.set('status', statusFilter);
			if (search.trim()) params.set('search', search.trim());
			const res = await fetch(`/api/admin/hopium/questions${params.size ? `?${params}` : ''}`);
			if (res.ok) questions = await res.json();
		} catch {
			toast.error('Failed to load questions');
		} finally {
			loading = false;
		}
	}

	async function loadSettings() {
		settingsLoading = true;
		try {
			const res = await fetch('/api/admin/hopium/settings');
			if (res.ok) {
				settings = await res.json();
				targetInput = String(settings.targetCount);
			}
		} catch {
			/* ignore */
		} finally {
			settingsLoading = false;
		}
	}

	async function saveSettings() {
		savingSettings = true;
		try {
			const res = await fetch('/api/admin/hopium/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					autogenerate: settings.autogenerate,
					targetCount: parseInt(targetInput) || 0
				})
			});
			if (res.ok) {
				settings = await res.json();
				targetInput = String(settings.targetCount);
				toast.success('Hopium settings saved');
			} else {
				toast.error('Failed to save settings');
			}
		} finally {
			savingSettings = false;
		}
	}

	function toLocalInput(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function openResolve(q: HopiumQuestion, resolution: boolean) {
		dialogMode = 'resolve';
		dialogQuestion = q;
		dialogResolution = resolution;
		dialogReasoning = '';
		dialogOpen = true;
	}

	function openReverse(q: HopiumQuestion, resolution: boolean) {
		dialogMode = 'reverse';
		dialogQuestion = q;
		dialogResolution = resolution;
		dialogReasoning = '';
		dialogOpen = true;
	}

	function openCancel(q: HopiumQuestion) {
		dialogMode = 'cancel';
		dialogQuestion = q;
		dialogReasoning = '';
		dialogOpen = true;
	}

	function openEdit(q: HopiumQuestion) {
		dialogMode = 'edit';
		dialogQuestion = q;
		dialogText = q.question;
		dialogDate = toLocalInput(q.resolutionDate);
		dialogWebSearch = false;
		dialogOpen = true;
	}

	function openCreate() {
		dialogMode = 'create';
		dialogQuestion = null;
		dialogText = '';
		dialogDate = '';
		dialogWebSearch = false;
		dialogOpen = true;
	}

	let dialogTitle = $derived.by(() => {
		switch (dialogMode) {
			case 'resolve':
				return `Force-resolve → ${dialogResolution ? 'YES' : 'NO'}`;
			case 'reverse':
				return `Reverse resolution → ${dialogResolution ? 'YES' : 'NO'}`;
			case 'cancel':
				return 'Cancel & refund';
			case 'edit':
				return 'Edit question';
			case 'create':
				return 'Create question';
			default:
				return '';
		}
	});

	async function submitDialog() {
		if (!dialogMode) return;
		submitting = true;
		try {
			let res: Response;
			if (dialogMode === 'resolve' || dialogMode === 'reverse') {
				const action = dialogMode === 'resolve' ? 'force-resolve' : 'reverse';
				res = await fetch(`/api/admin/hopium/questions/${dialogQuestion!.id}/${action}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ resolution: dialogResolution, reasoning: dialogReasoning.trim() })
				});
			} else if (dialogMode === 'cancel') {
				res = await fetch(`/api/admin/hopium/questions/${dialogQuestion!.id}/cancel`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ reason: dialogReasoning.trim() })
				});
			} else if (dialogMode === 'edit') {
				res = await fetch(`/api/admin/hopium/questions/${dialogQuestion!.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						question: dialogText.trim(),
						resolutionDate: new Date(dialogDate).toISOString(),
						requiresWebSearch: dialogWebSearch
					})
				});
			} else {
				// create
				res = await fetch('/api/admin/hopium/questions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						question: dialogText.trim(),
						resolutionDate: new Date(dialogDate).toISOString(),
						requiresWebSearch: dialogWebSearch
					})
				});
			}

			if (res.ok) {
				toast.success(`${dialogMode} done`);
				dialogOpen = false;
				await loadQuestions();
			} else {
				const err = await res.json();
				toast.error(err.error || 'Action failed');
			}
		} catch {
			toast.error('Action failed');
		} finally {
			submitting = false;
		}
	}

	onMount(() => {
		loadQuestions();
		loadSettings();
	});

	function statusVariant(s: Status) {
		return s === 'ACTIVE' ? 'default' : s === 'RESOLVED' ? 'secondary' : 'outline';
	}
</script>

<svelte:head>
	<title>Hopium Moderation - Admin | Rugplay</title>
</svelte:head>

<div class="container mx-auto max-w-5xl space-y-4 py-6">
	<div class="flex items-center gap-2">
		<HugeiconsIcon icon={ArrowUpDownIcon} class="h-5 w-5" />
		<h2 class="text-lg font-semibold">Hopium Moderation</h2>
	</div>

	<!-- Settings + Create -->
	<div class="grid gap-4 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<HugeiconsIcon icon={Settings01Icon} class="h-4 w-4" />
					AI Generation
				</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium">Auto-generate questions</p>
						<p class="text-muted-foreground text-xs">Scheduler keeps the pool topped up.</p>
					</div>
					<Switch
						bind:checked={settings.autogenerate}
						disabled={settingsLoading || savingSettings}
					/>
				</div>
				<div class="flex items-end gap-2">
					<div class="flex-1 space-y-1">
						<Label for="target" class="text-sm">Target active count</Label>
						<Input id="target" type="number" min="0" bind:value={targetInput} class="h-9" />
					</div>
					<Button onclick={saveSettings} disabled={savingSettings || settingsLoading} size="sm">
						{#if savingSettings}
							<HugeiconsIcon icon={Loading03Icon} class="h-4 w-4 animate-spin" />
						{:else}
							Save
						{/if}
					</Button>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<HugeiconsIcon icon={Add01Icon} class="h-4 w-4" />
					Manual Question
				</Card.Title>
			</Card.Header>
			<Card.Content>
				<p class="text-muted-foreground mb-3 text-sm">
					Add a hand-written question (bypasses the AI generator).
				</p>
				<Button onclick={openCreate} class="w-full">
					<HugeiconsIcon icon={Add01Icon} class="h-4 w-4" />
					Create Question
				</Button>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Filters -->
	<Card.Root>
		<Card.Header class="flex flex-row items-center justify-between">
			<Card.Title class="text-base">Questions</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="flex flex-wrap items-center gap-2">
				{#each ['ALL', 'ACTIVE', 'RESOLVED', 'CANCELLED'] as s}
					<Button
						size="sm"
						variant={statusFilter === s ? 'default' : 'outline'}
						onclick={() => {
							statusFilter = s as Status | 'ALL';
							loadQuestions();
						}}>{s}</Button
					>
				{/each}
				<Input
					type="text"
					placeholder="Search question text…"
					bind:value={search}
					oninput={() => {}}
					class="ml-auto max-w-xs"
				/>
				<Button size="sm" variant="outline" onclick={loadQuestions}>Search</Button>
			</div>

			{#if loading}
				<div class="space-y-2">
					{#each Array(5) as _}
						<Skeleton class="h-20 w-full rounded-lg" />
					{/each}
				</div>
			{:else if questions.length === 0}
				<p class="text-muted-foreground py-8 text-center text-sm">No questions match.</p>
			{:else}
				<div class="max-h-[40rem] space-y-2 overflow-y-auto">
					{#each questions as q (q.id)}
						<div class="space-y-2 rounded-lg border p-3">
							<div class="flex items-start justify-between gap-2">
								<a href={`/hopium/${q.id}`} class="flex-1 font-medium hover:underline">
									{q.question}
								</a>
								<Badge variant={statusVariant(q.status)} class="shrink-0 text-xs">
									{q.status}
									{#if q.status === 'RESOLVED' && q.aiResolution !== null}
										· {q.aiResolution ? 'YES' : 'NO'}
									{/if}
								</Badge>
							</div>

							<div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
								<span class="text-green-500">YES ${formatValue(q.totalYes)}</span>
								<span class="text-red-500">NO ${formatValue(q.totalNo)}</span>
								<span>{q.betCount} bets</span>
								<span>resolves {formatRelativeTime(new Date(q.resolutionDate))}</span>
							</div>

							{#if q.aiReasoning}
								<p class="text-muted-foreground line-clamp-2 text-xs">
									<span class="font-medium">AI:</span> {q.aiReasoning}
								</p>
							{/if}

							<div class="flex flex-wrap gap-2 pt-1">
								{#if q.status === 'ACTIVE'}
									<Button size="sm" variant="default" onclick={() => openResolve(q, true)}>
										Resolve YES
									</Button>
									<Button
										size="sm"
										variant="outline"
										onclick={() => openResolve(q, false)}
									>Resolve NO</Button
									>
									<Button size="sm" variant="outline" onclick={() => openCancel(q)}>
										<HugeiconsIcon icon={Cancel01Icon} class="h-4 w-4" />
										Cancel
									</Button>
								{:else if q.status === 'RESOLVED'}
									<Button size="sm" variant="outline" onclick={() => openReverse(q, true)}>
										Reverse → YES
									</Button>
									<Button size="sm" variant="outline" onclick={() => openReverse(q, false)}>
										Reverse → NO
									</Button>
								{/if}
								<Button size="sm" variant="ghost" onclick={() => openEdit(q)}>Edit</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<!-- Action dialog -->
<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{dialogTitle}</Dialog.Title>
			{#if dialogQuestion}
				<Dialog.Description class="line-clamp-2">{dialogQuestion.question}</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="space-y-4">
			{#if dialogMode === 'resolve' || dialogMode === 'reverse'}
				<div>
					<div class="mb-2 text-sm font-medium">Outcome</div>
					<div class="grid grid-cols-2 gap-2">
						<Button
							variant={dialogResolution ? 'default' : 'outline'}
							onclick={() => (dialogResolution = true)}>YES</Button
						>
						<Button
							variant={!dialogResolution ? 'default' : 'outline'}
							onclick={() => (dialogResolution = false)}>NO</Button
						>
					</div>
				</div>
				<div>
					<Label for="reasoning" class="mb-2 block text-sm font-medium">
						Reasoning {#if dialogMode === 'resolve'}(shown to users){/if}
					</Label>
					<Textarea id="reasoning" bind:value={dialogReasoning} rows={3} placeholder="Admin reasoning…" />
				</div>
			{:else if dialogMode === 'cancel'}
				<div>
					<Label for="reason" class="mb-2 block text-sm font-medium">Reason (optional)</Label>
					<Textarea
						id="reason"
						bind:value={dialogReasoning}
						rows={3}
						placeholder="Refunds all bettors…"
					/>
				</div>
			{:else if dialogMode === 'edit' || dialogMode === 'create'}
				<div class="space-y-1">
					<Label for="qtext" class="text-sm">Question</Label>
					<Textarea id="qtext" bind:value={dialogText} rows={2} maxlength={200} />
				</div>
				<div class="space-y-1">
					<Label for="qdate" class="text-sm">Resolution date</Label>
					<Input id="qdate" type="datetime-local" bind:value={dialogDate} />
				</div>
				<div class="flex items-center justify-between">
					<Label for="qweb" class="text-sm">Requires web search</Label>
					<Switch id="qweb" bind:checked={dialogWebSearch} />
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button
				onclick={submitDialog}
				disabled={submitting
					|| ((dialogMode === 'resolve' || dialogMode === 'reverse') && !dialogReasoning.trim())
					|| ((dialogMode === 'edit' || dialogMode === 'create') && (!dialogText.trim() || !dialogDate))}
			>
				{#if submitting}
					<HugeiconsIcon icon={Loading03Icon} class="h-4 w-4 animate-spin" />
				{:else}
					<HugeiconsIcon icon={Tick01Icon} class="h-4 w-4" />
				{/if}
				Confirm
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
