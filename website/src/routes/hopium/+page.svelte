<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as HoverCard from '$lib/components/ui/hover-card';
	import { Badge } from '$lib/components/ui/badge';
	import * as Avatar from '$lib/components/ui/avatar';
	import UserProfilePreview from '$lib/components/self/UserProfilePreview.svelte';
	import UserName from '$lib/components/self/UserName.svelte';
	import HopiumSkeleton from '$lib/components/self/skeletons/HopiumSkeleton.svelte';
	import SEO from '$lib/components/self/SEO.svelte';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		TradeUpIcon,
		TradeDownIcon,
		Clock01Icon,
		SparklesIcon,
		Globe02Icon,
		Tick01Icon,
		Cancel01Icon
	} from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import { formatDateWithYear, formatTimeUntil, formatValue, getPublicUrl } from '$lib/utils';
	import { goto } from '$app/navigation';
	import type { PredictionQuestion } from '$lib/types/prediction';
	import AdLong from '$lib/components/self/ads/AdLong.svelte';
	import { haptic } from '$lib/stores/haptics';

	let questions = $state<PredictionQuestion[]>([]);
	let loading = $state(true);
	let activeTab = $state('active');

	onMount(() => {
		fetchQuestions();
	});

	async function fetchQuestions() {
		try {
			const status =
				activeTab === 'active' ? 'ACTIVE' : activeTab === 'resolved' ? 'RESOLVED' : 'ALL';

			// TODO: PAGINATION
			const response = await fetch(`/api/hopium/questions?status=${status}&limit=50`);
			if (response.ok) {
				const data = await response.json();
				questions = data.questions;
			} else {
				toast.error('Failed to load questions');
			}
		} catch (e) {
			console.error('Failed to fetch questions:', e);
			toast.error('Failed to load questions');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (activeTab) {
			loading = true;
			fetchQuestions();
		}
	});

	// Custom tabs implementation
	const tabs = [
		{ value: 'active', label: 'Active' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'all', label: 'All' }
	];
</script>

<SEO
	title="Hopium - Rugplay"
	description="AI-generated pop-culture prediction markets in the Rugplay simulation game. Predict YES or NO outcomes with virtual currency."
	keywords="AI prediction markets game, virtual prediction simulation, cryptocurrency prediction game, forecasting game, virtual currency predictions"
/>

<div class="container mx-auto max-w-7xl p-6">
	<header class="mb-8">
		<div class="text-center">
			<h1 class="mb-2 flex items-center justify-center gap-2 text-3xl font-bold">
				<HugeiconsIcon icon={SparklesIcon} class="h-8 w-8 text-purple-500" />
				Hopium
			</h1>
			<p class="text-muted-foreground mb-6">
				AI-generated pop-culture predictions. Bet YES or NO on what's hot right now.
			</p>
		</div>
	</header>

	<!-- Custom Tabs Implementation -->
	<div class="w-full">
		<div class="mb-6 flex items-center justify-center gap-2">
			<!-- Custom Tabs List -->
			<div class="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]">
				<div class="grid w-full max-w-md grid-cols-3">
					{#each tabs as tab}
						<button
							onclick={() => { haptic.trigger('selection'); activeTab = tab.value; }}
							class="data-[state=active]:bg-background data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-sm font-medium transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm"
							data-state={activeTab === tab.value ? 'active' : 'inactive'}
						>
							{tab.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Custom Tabs Content -->
		<div class="flex-1 outline-none">
			{#if loading}
				<HopiumSkeleton />
			{:else if questions.length === 0}
				<div class="py-16 text-center">
					<h3 class="mb-2 text-lg font-semibold">No questions here right now</h3>
					<p class="text-muted-foreground mb-6">
						AI generates fresh pop-culture questions every minute — check back shortly.
					</p>
				</div>
			{:else}
				<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{#each questions as question}
						<Card.Root
							class="bg-card hover:bg-card/90 flex cursor-pointer flex-col overflow-hidden transition-colors"
							onclick={() => goto(`/hopium/${question.id}`)}
						>
							<Card.Header class="pb-4">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 flex-1">
										<h3 class="break-all text-lg font-medium">
											{question.question}
										</h3>
									</div>

									<div class="flex flex-col items-end gap-2">
										{#if question.status === 'RESOLVED'}
											<Badge
												variant="destructive"
												class="flex flex-shrink-0 items-center gap-1 {question.aiResolution
													? 'bg-success/80!'
													: ''}"
											>
												{#if question.aiResolution}
													<HugeiconsIcon icon={Tick01Icon} class="h-3 w-3" />
													YES
												{:else}
													<HugeiconsIcon icon={Cancel01Icon} class="h-3 w-3" />
													NO
												{/if}
											</Badge>
										{:else if question.status === 'CANCELLED'}
											<Badge variant="outline" class="flex flex-shrink-0 items-center gap-1 text-muted-foreground border-muted-foreground">
												<HugeiconsIcon icon={Cancel01Icon} class="h-3 w-3" />
												SKIP
											</Badge>
										{/if}

										<!-- Probability Meter -->
										<div class="relative flex h-12 w-16 items-end justify-center">
											<svg class="h-10 w-16" viewBox="0 0 64 32">
												<!-- Background arc -->
												<path
													d="M 8 28 A 24 24 0 0 1 56 28"
													fill="none"
													stroke="var(--muted-foreground)"
													stroke-width="3"
													stroke-linecap="round"
													opacity="0.3"
												/>
												<!-- Progress arc -->
												<path
													d="M 8 28 A 24 24 0 0 1 56 28"
													fill="none"
													stroke="var(--primary)"
													stroke-width="3"
													stroke-linecap="round"
													stroke-dasharray={Math.PI * 24}
													stroke-dashoffset={Math.PI * 24 -
														(question.yesPercentage / 100) * Math.PI * 24}
													class="transition-all duration-300 ease-in-out"
												/>
											</svg>
											<div class="absolute bottom-0 text-sm font-medium">
												{question.yesPercentage.toFixed(0)}%
											</div>
										</div>
									</div>
								</div>

								<div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
									<div class="flex items-center gap-1">
										<HugeiconsIcon icon={Clock01Icon} class="h-3 w-3" />
										{#if question.status === 'ACTIVE'}
											{formatTimeUntil(question.resolutionDate).startsWith('Ended') ? 'Resolving' : `${formatTimeUntil(question.resolutionDate)} remaining`}
										{:else}
											Resolved {formatDateWithYear(question.resolvedAt || '')}
										{/if}
									</div>
									<span>•</span>
									<div class="flex items-center gap-1">
										{formatValue(question.totalAmount)}
									</div>
									{#if question.requiresWebSearch}
										<span>•</span>
										<HugeiconsIcon icon={Globe02Icon} class="h-3 w-3 text-blue-500" />
									{/if}
								</div>

								<div class="mb-2 mt-2 flex items-center gap-2 text-sm">
									{#if question.creator.id === null}
										<div
											class="bg-purple-500/15 text-purple-400 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
										>
											<HugeiconsIcon icon={SparklesIcon} class="h-3 w-3" />
											Rugplay AI
										</div>
									{:else}
										<HoverCard.Root>
											<HoverCard.Trigger>
												<button
													class="flex cursor-pointer items-center gap-2 text-left hover:underline"
												>
													<Avatar.Root class="h-5 w-5">
														<Avatar.Image
															src={getPublicUrl(question.creator.image)}
															alt={question.creator.name}
														/>
														<Avatar.Fallback class="text-xs"
															>{question.creator.name.charAt(0)}</Avatar.Fallback
														>
													</Avatar.Root>
													<span class="text-muted-foreground"><UserName
															name={question.creator.name}
															nameColor={question.creator.nameColor}
														/></span>
												</button>
											</HoverCard.Trigger>
											<HoverCard.Content class="w-80">
												<UserProfilePreview userId={question.creator.id!} />
											</HoverCard.Content>
										</HoverCard.Root>
									{/if}
								</div>

								<!-- User's bet amounts if they have any -->
								{#if question.userBets && (question.userBets.yesAmount > 0 || question.userBets.noAmount > 0)}
									<div class="text-muted-foreground flex items-center gap-4 text-sm">
										<span>Your stakes:</span>
										{#if question.userBets.yesAmount > 0}
											<div class="flex items-center gap-1">
												<HugeiconsIcon icon={TradeUpIcon} class="h-3 w-3 text-green-600" />
												<span class="text-green-600"
													>YES: ${question.userBets.yesAmount.toFixed(2)}</span
												>
											</div>
										{/if}
										{#if question.userBets.noAmount > 0}
											<div class="flex items-center gap-1">
												<HugeiconsIcon icon={TradeDownIcon} class="h-3 w-3 text-red-600" />
												<span class="text-red-600"
													>NO: ${question.userBets.noAmount.toFixed(2)}</span
												>
											</div>
										{/if}
									</div>
								{/if}
							</Card.Header>
						</Card.Root>
					{/each}
				</div>

				<AdLong />
			{/if}
		</div>
	</div>
</div>
