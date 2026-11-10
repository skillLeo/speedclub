<script setup lang="ts">
import { computed } from 'vue';
import Skeleton from '../ui/Skeleton.vue';
import StatusPill from '../ui/StatusPill.vue';
import Tabs, { type TabItem } from '../ui/Tabs.vue';
import type { Tone } from '../ui/Badge.vue';
import PageHeader, { type Crumb } from '../shell/PageHeader.vue';
import ActivityTimeline, { type TimelineEntry } from './ActivityTimeline.vue';

/**
 * Record page (03 §14, 06 §5): header with status and key actions, tabs, right activity timeline from the audit log.
 * Slots: `actions` (header buttons), `meta` (key facts under the title), one slot per tab value, `aside` (replaces the timeline),
 * `loading` (the panel while `loading`; default: label/value pairs).
 * The parent owns the tab (v-model:tab), e.g. to keep it in ?tab=.
 *
 * - `loading` (DQ-533): the same parts in the same places: crumbs, a title skeleton with its status, a meta line and
 *   `loadingActions` button skeletons, the real tabs, the panel skeleton and the activity column's own loading state.
 * - `asideHidden`: the tab needs the full width (e.g. an audit table that would repeat the activity column, DQ-535).
 * - The activity column is 240 wide at 1280 and 320 from 1440, so seven tabs keep their room (DQ-525).
 */
const tab = defineModel<string>('tab', { required: true });
const props = withDefaults(
    defineProps<{
        title: string;
        crumbs?: Crumb[];
        status?: { tone: Tone; label: string } | null;
        tabs: TabItem[];
        tabsLabel: string;
        activity?: TimelineEntry[];
        activityState?: 'ready' | 'loading' | 'error';
        activityHref?: string;
        loading?: boolean;
        loadingActions?: number;
        /** DQ-555: the meta line's height while loading: `controls` 32 (links or buttons in it), `line` 20 (one line of text). */
        loadingMeta?: 'controls' | 'line';
        /** DQ-555: the header's actions on their own row under the meta line (records with four or more actions). */
        actionsBelow?: boolean;
        asideHidden?: boolean;
        testId: string;
    }>(),
    { crumbs: () => [], status: null, activity: () => [], activityState: 'ready', activityHref: undefined, loading: false, loadingActions: 3, loadingMeta: 'controls', actionsBelow: false, asideHidden: false },
);
const emit = defineEmits<{ 'retry-activity': [] }>();
const tabSlots = computed(() => props.tabs.map((t) => t.value));
</script>

<template>
    <div class="flex flex-col gap-24" :data-testid="testId" :aria-busy="loading || undefined">
        <PageHeader :title="title" :crumbs="crumbs" :loading="loading" :actions-below="actionsBelow">
            <template v-if="loading" #badge>
                <Skeleton class="h-20 w-80" />
            </template>
            <template v-else-if="status" #badge>
                <StatusPill :tone="status.tone" :label="status.label" :data-testid="`${testId}.status`" />
            </template>
            <template v-if="loading" #meta>
                <span class="flex items-center" :class="loadingMeta === 'line' ? 'h-20' : 'h-32'" aria-hidden="true"><Skeleton shape="text" class="w-320" /></span>
            </template>
            <template v-else-if="$slots.meta" #meta><slot name="meta" /></template>
            <template v-if="loading" #actions>
                <Skeleton v-for="n in loadingActions" :key="n" class="h-32 w-120" />
            </template>
            <template v-else-if="$slots.actions" #actions><slot name="actions" /></template>
        </PageHeader>
        <div class="flex min-w-0 flex-col gap-32 desktop:flex-row">
            <div class="min-w-0 flex-1">
                <Tabs v-model="tab" :items="tabs" :label="tabsLabel" :panels="!loading">
                    <template v-for="name in tabSlots" :key="name" #[name]>
                        <slot :name="name" />
                    </template>
                </Tabs>
                <div v-if="loading" class="pt-24" :data-testid="`${testId}.loading`">
                    <slot name="loading">
                        <dl class="grid grid-cols-1 gap-x-24 gap-y-16 tablet:grid-cols-2" aria-hidden="true">
                            <div v-for="n in 8" :key="n" class="flex flex-col gap-2">
                                <span class="flex h-16 items-center"><Skeleton shape="text" class="w-80" /></span>
                                <span class="flex h-20 items-center"><Skeleton shape="text" class="w-200" /></span>
                            </div>
                        </dl>
                    </slot>
                </div>
            </div>
            <aside v-if="!asideHidden" class="min-w-0 shrink-0 desktop:w-240 desktop:border-l desktop:border-line-subtle desktop:pl-24 wide:w-320">
                <slot v-if="!loading" name="aside">
                    <ActivityTimeline :entries="activity" :state="activityState" :more-href="activityHref" :test-id="`${testId}.activity`" @retry="emit('retry-activity')" />
                </slot>
                <ActivityTimeline v-else :entries="[]" state="loading" :test-id="`${testId}.activity`" />
            </aside>
        </div>
    </div>
</template>
