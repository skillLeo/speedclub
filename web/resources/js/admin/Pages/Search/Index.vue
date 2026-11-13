<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhMagnifyingGlass } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import Button from '../../Components/ui/Button.vue';
import EmptyQueue from '../../Components/ui/EmptyQueue.vue';
import Input from '../../Components/ui/Input.vue';
import Skeleton from '../../Components/ui/Skeleton.vue';
import { focusRing } from '../../Components/ui/styles';
import { usePageState } from '../../composables/pageState';
import { formatNumber } from '../../lib/format';
import { qaState } from '../../lib/qa';
import { routeOr } from '../../lib/routes';
import type { SearchGroup } from '../../types/search';

/** ADM-07 grouped results: members, vehicles, QR codes, cases. Each group only for the atoms the staff member holds (server). */
const props = defineProps<{ q: string; groups: SearchGroup[] }>();

// ?qaState=empty shows the idle page: the field is empty too (DQ-512).
const term = ref(qaState() === 'empty' ? '' : props.q);
const loading = ref(false);
const failed = ref(false);
watch(
    () => props.q,
    (q) => (term.value = q),
);

const total = computed(() => props.groups.reduce((sum, group) => sum + group.items.length, 0));
const state = usePageState(() => (failed.value ? 'error' : props.q === '' ? 'empty' : 'ready'));

function submit(): void {
    const q = term.value.trim();
    router.get(routeOr('admin.search', '/admin/search'), q === '' ? {} : { q }, {
        preserveState: true,
        replace: true,
        onStart: () => {
            loading.value = true;
            failed.value = false;
        },
        onFinish: () => (loading.value = false),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
</script>

<template>
    <Head :title="trans('search.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-07" :data-qa-state="state">
        <PageHeader :title="trans('search.title')" :crumbs="[{ label: trans('shell.groups.overview') }]" :description="trans('search.intro')" />

        <form role="search" class="flex max-w-640 items-end gap-8" @submit.prevent="submit">
            <div class="flex-1">
                <label for="admin-search" class="sr-only">{{ trans('search.label') }}</label>
                <Input id="admin-search" v-model="term" type="text" enterkeyhint="search" autocomplete="off" maxlength="120" :placeholder="trans('search.placeholder')" autofocus data-testid="ADM-07.input">
                    <template #leading><PhMagnifyingGlass :size="16" aria-hidden="true" /></template>
                </Input>
            </div>
            <Button type="submit" variant="primary" :loading="loading" data-testid="ADM-07.submit">{{ trans('search.submit') }}</Button>
        </form>

        <!-- The results' own geometry: the count line says what runs, then groups as bordered lists of 40 rows. -->
        <div v-if="loading || state === 'loading'" class="flex flex-col gap-32" aria-busy="true" data-testid="ADM-07.loading">
            <p class="text-admin-base text-ink-2" aria-live="polite">{{ trans('search.searching', { q: term.trim() }) }}</p>
            <div v-for="n in 2" :key="n" class="flex flex-col gap-8">
                <div class="flex h-28 items-center"><Skeleton shape="text" class="w-120" /></div>
                <ul class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="m in 3" :key="m" class="flex h-40 items-center gap-12 border-b border-line-subtle px-12 last:border-b-0">
                        <Skeleton shape="text" class="w-160" />
                        <span class="flex-1" />
                        <Skeleton shape="text" class="w-120" />
                    </li>
                </ul>
            </div>
        </div>
        <StateBlock v-else-if="state === 'error'" kind="error" :title="trans('ui.state.error_title')" :body="trans('ui.state.error_body')" test-id="ADM-07.error" @retry="submit" />
        <EmptyQueue v-else-if="state === 'empty'" variant="quiet" :icon="PhMagnifyingGlass" :title="trans('search.empty_title')" :body="trans('search.empty_body')" data-testid="ADM-07.empty" />
        <EmptyQueue v-else-if="total === 0" variant="quiet" :icon="PhMagnifyingGlass" :title="trans('search.no_results_title', { q })" :body="trans('search.no_results_body')" data-testid="ADM-07.no-results" />

        <div v-else class="flex flex-col gap-32" data-testid="ADM-07.results">
            <p class="text-admin-base text-ink-2 tabular-nums" aria-live="polite">{{ trans('search.count', { count: formatNumber(total), q }) }}</p>
            <section v-for="group in groups.filter((g) => g.items.length > 0)" :key="group.group" :aria-labelledby="`search-${group.group}`" class="flex flex-col gap-8" :data-testid="`ADM-07.group.${group.group}`">
                <h2 :id="`search-${group.group}`" class="flex items-baseline gap-8 text-headline text-ink">
                    {{ trans(`search.groups.${group.group}`) }}
                    <span class="text-caption text-ink-3 tabular-nums">{{ formatNumber(group.items.length) }}</span>
                </h2>
                <ul class="flex flex-col rounded-sm border border-line-subtle bg-surface">
                    <li v-for="item in group.items" :key="item.id" class="border-b border-line-subtle last:border-b-0">
                        <component
                            :is="item.url ? Link : 'div'"
                            :href="item.url ?? undefined"
                            :class="[item.url ? `${focusRing} hover:bg-hover` : '', 'flex h-40 items-center gap-12 px-12']"
                        >
                            <span class="min-w-0 flex-1 truncate text-admin-base text-ink">{{ item.title }}</span>
                            <span v-if="item.subtitle" class="max-w-320 truncate text-caption text-ink-3">{{ item.subtitle }}</span>
                        </component>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
