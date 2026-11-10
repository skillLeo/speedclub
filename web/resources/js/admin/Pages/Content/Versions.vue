<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhClockCounterClockwise, PhPencilSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import DiffViewer from '../../Components/patterns/DiffViewer.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, ConfirmDialog, EmptyQueue, Skeleton, StatusPill, Tabs } from '../../Components/ui';
import { focusRing } from '../../Components/ui/styles';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import type { VersionInfo } from './Partials/configDraft';

/**
 * ADM-35 Versionsverlauf (06 §1.5/§3): per config key every published version with who, when and why; the chosen version against the
 * one before it; "Zurückrollen" ⚿ publishes a copy of it as the newest version with a reason (history is never edited). A rollback
 * that switches maintenance on needs a second person.
 */
interface Chosen extends VersionInfo {
    payload: Record<string, unknown>;
    previous: { version: number; payload: Record<string, unknown> } | null;
    needs_approval: string | null;
}

const props = defineProps<{
    keys: string[];
    configKey: string;
    versions: VersionInfo[];
    chosen: Chosen | null;
    draft: { version: number; author: string | null; updated_at: string | null } | null;
    canRollback: boolean;
    editRoute: string;
    accentDefault?: string | null;
}>();

const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const versions = computed(() => (pageState.value === 'empty' ? [] : props.versions));
const chosen = computed(() => (pageState.value === 'empty' ? null : props.chosen));

const base = routeOr('admin.content.versions', '/admin/content/versions');
const tab = computed({
    get: () => props.configKey,
    set: (value: string) => router.visit(`${base}?key=${value}`, { preserveScroll: true }),
});
const tabs = computed(() => props.keys.map((value) => ({ value, label: trans(`content.versions.keys.${value}`) })));
const versionHref = (version: number) => `${base}?key=${props.configKey}&version=${version}`;

const action = useAdminAction();
const rollbackOpen = ref(false);
function rollback(reason: string | null): void {
    if (!chosen.value) return;
    action.run('post', routeOr('admin.content.versions.rollback', `/admin/content/versions/${props.configKey}/${chosen.value.version}/rollback`, { key: props.configKey, version: chosen.value.version }), { reason }, { sensitive: true, onSuccess: () => (rollbackOpen.value = false) });
}
const mayRollback = computed(() => props.canRollback && chosen.value !== null && chosen.value.status === 'superseded');
const fourEyes = computed(() => chosen.value?.needs_approval != null);
// QA overlay ?dialog=rollback: only where a rollback exists (a superseded version), never for the live one (DQ-626).
if (qaDialog() === 'rollback' && mayRollback.value) rollbackOpen.value = true;
const editHref = computed(() => routeOr(props.editRoute, '/admin'));

/**
 * DQ-626: the branding diff in the words of ADM-28 ("Akzentfarbe: Signalrot → Rennblau", "Willkommen (App): Mitgeliefertes Foto →
 * Hochgeladenes Foto"), never schema keys, `null` or file paths. Other keys keep their structure; empty values read "–".
 */
const BRAND_LOGOS = ['wordmark_white', 'wordmark_black', 'square', 'app_mark'] as const;
const BRAND_HEROES = ['welcome', 'landing', 'splash'] as const;
function readable(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const p = payload ?? {};
    if (props.configKey !== 'branding') return p;
    const out: Record<string, string> = {};
    const image = (value: unknown): string => (typeof value === 'string' && value !== '' ? trans('content.versions.brand.uploaded') : trans('content.versions.brand.bundled'));
    const logos = (p.logos ?? {}) as Record<string, unknown>;
    for (const slot of BRAND_LOGOS) out[trans(`brand.logos.${slot}`)] = image(logos[slot]);
    const heroes = (p.heroes ?? {}) as Record<string, { asset_id?: string; focal_x?: number; focal_y?: number } | null>;
    for (const slot of BRAND_HEROES) {
        const hero = heroes[slot];
        out[trans(`brand.heroes.${slot}`)] = hero?.asset_id
            ? trans('content.versions.brand.hero', { x: String(Math.round((hero.focal_x ?? 0.5) * 100)), y: String(Math.round((hero.focal_y ?? 0.5) * 100)) })
            : trans('content.versions.brand.bundled');
    }
    out[trans('brand.og.title')] = image(p.og_default);
    // `default` (the alias of the first install) reads as the set it stands for, so v1 → v2 is no change when v2 picked that set.
    if (typeof p.accent_set === 'string') out[trans('brand.accent.title')] = trans(`brand.accent.sets.${p.accent_set === 'default' && props.accentDefault ? props.accentDefault : p.accent_set}`);
    if (typeof p.default_theme === 'string') out[trans('brand.themes.title')] = trans(`brand.themes.${p.default_theme}`);
    return out;
}
</script>

<template>
    <Head :title="trans('content.versions.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-35" :data-qa-state="pageState">
        <PageHeader :title="trans('content.versions.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.versions.intro')" />
        <Tabs v-model="tab" :items="tabs" :label="trans('content.versions.keys_label')" :panels="false" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('content.versions.error')" :body="trans('ui.state.error_body')" test-id="ADM-35.error" @retry="router.reload()" />
        <template v-else>
            <div v-if="draft && pageState === 'ready'" class="flex flex-wrap items-center justify-between gap-12 rounded-sm border border-line bg-surface px-16 py-12" data-testid="ADM-35.draft">
                <p class="text-supporting text-ink-2">{{ trans('content.versions.draft', { version: String(draft.version), name: draft.author ?? trans('config.draft.someone'), date: formatDateTime(draft.updated_at) }) }}</p>
                <Button size="sm" variant="secondary" :icon="PhPencilSimple" :href="editHref">{{ trans('content.versions.open_editor') }}</Button>
            </div>

            <div class="flex flex-col items-start gap-24 wide:flex-row">
                <section class="w-full min-w-0 wide:w-560" :aria-label="trans('content.versions.list')">
                    <EmptyQueue v-if="pageState !== 'loading' && versions.length === 0" variant="first" :icon="PhClockCounterClockwise" :title="trans('content.versions.empty_title')" :body="trans('content.versions.empty_body')" data-testid="ADM-35.empty" />
                    <ScrollRegion v-else :label="trans('content.versions.list')">
                        <table class="w-full text-supporting" data-testid="ADM-35.table">
                            <caption class="sr-only">{{ trans('content.versions.list') }}</caption>
                            <thead>
                                <tr class="h-40 border-b border-line text-left text-label-s text-ink-2">
                                    <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('content.versions.columns.version') }}</th>
                                    <th scope="col" class="px-12">{{ trans('content.versions.columns.status') }}</th>
                                    <th scope="col" class="px-12">{{ trans('content.versions.columns.published') }}</th>
                                    <th scope="col" class="px-12">{{ trans('content.versions.columns.reason') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <template v-if="pageState === 'loading'">
                                    <tr v-for="n in 6" :key="n" class="h-40 border-b border-line-subtle" aria-hidden="true">
                                        <td v-for="c in 4" :key="c" class="px-12"><Skeleton shape="text" :class="c === 4 ? 'w-160' : 'w-64'" /></td>
                                    </tr>
                                </template>
                                <tr v-for="row in pageState === 'loading' ? [] : versions" :key="row.version" class="border-b border-line-subtle last:border-b-0" :class="chosen?.version === row.version ? 'bg-selected' : ''" data-testid="ADM-35.row">
                                    <td class="h-40 px-12 text-right tabular-nums">
                                        <Link :href="versionHref(row.version)" :class="[focusRing, 'inline-flex h-32 min-w-32 items-center justify-end rounded-xs px-4 text-ink underline-offset-2 hover:underline']" preserve-scroll :aria-current="chosen?.version === row.version ? 'true' : undefined">{{ trans('content.versions.v', { version: String(row.version) }) }}</Link>
                                    </td>
                                    <td class="whitespace-nowrap px-12"><StatusPill :tone="row.status === 'published' ? 'success' : 'neutral'" :label="trans(`content.versions.status.${row.status}`)" /></td>
                                    <td class="px-12 py-4">
                                        <span class="block whitespace-nowrap tabular-nums text-ink-2">{{ formatDateTime(row.published_at) }}</span>
                                        <span class="block text-helper text-ink-2">{{ row.published_by ?? trans('config.draft.person') }}</span>
                                    </td>
                                    <td class="px-12 py-4 text-ink-2">{{ row.reason ?? '–' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </ScrollRegion>
                </section>

                <section v-if="pageState === 'loading'" class="flex w-full min-w-0 flex-1 flex-col gap-12" aria-hidden="true">
                    <Skeleton shape="text" class="w-240" />
                    <Skeleton class="h-320 w-full rounded-sm" />
                </section>
                <section v-else-if="chosen" class="flex w-full min-w-0 flex-1 flex-col gap-16 rounded-sm border border-line bg-surface p-16" :aria-label="trans('content.versions.detail')" data-testid="ADM-35.detail">
                    <div class="flex flex-wrap items-start justify-between gap-12">
                        <div class="flex min-w-0 flex-col gap-4">
                            <h2 class="text-title-s text-ink">{{ chosen.previous ? trans('content.versions.compare', { version: String(chosen.version), previous: String(chosen.previous.version) }) : trans('content.versions.first', { version: String(chosen.version) }) }}</h2>
                            <p class="text-supporting text-ink-2">{{ chosen.reason ?? trans('content.versions.no_reason') }}</p>
                        </div>
                        <Button v-if="mayRollback" size="sm" variant="secondary" :icon="PhArrowCounterClockwise" data-testid="ADM-35.rollback" @click="rollbackOpen = true">{{ trans('content.versions.rollback', { version: String(chosen.version) }) }}</Button>
                    </div>
                    <DiffViewer :before="chosen.previous ? readable(chosen.previous.payload) : {}" :after="readable(chosen.payload)" changed-only test-id="ADM-35.diff" />
                    <p v-if="!canRollback && chosen.status === 'superseded'" class="text-helper text-ink-3" data-testid="ADM-35.elsewhere">
                        {{ trans('content.versions.change_elsewhere') }}
                        <Link :href="editHref" :class="[focusRing, 'rounded-xs text-ink underline']">{{ trans(`content.versions.keys.${configKey}`) }}</Link>
                    </p>
                </section>
            </div>
        </template>

        <ConfirmDialog
            v-model:open="rollbackOpen"
            :title="trans('content.versions.rollback_title', { version: String(chosen?.version ?? '') })"
            :body="fourEyes ? trans('content.versions.rollback_four_eyes') : trans('content.versions.rollback_body', { key: trans(`content.versions.keys.${configKey}`) })"
            :confirm-label="fourEyes ? trans('config.draft.request') : trans('content.versions.rollback_confirm')"
            tone="neutral"
            reason
            :four-eyes="fourEyes"
            :processing="action.processing.value"
            :error="failedDialog ? trans('ui.state.server_error') : action.error.value"
            test-id="ADM-35.rollback-dialog"
            @confirm="rollback"
        />
    </div>
</template>
