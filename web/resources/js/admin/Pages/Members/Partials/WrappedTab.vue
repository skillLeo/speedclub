<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { PhArrowsClockwise, PhImageBroken, PhLockSimple } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import ScrollRegion from '../../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../../Components/patterns/StateBlock.vue';
import { Badge, Button, Field, Select, Skeleton, StatusPill } from '../../../Components/ui';
import EmptyQueue from '../../../Components/ui/EmptyQueue.vue';
import { focusRing } from '../../../Components/ui/styles';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../../composables/recentPassword';
import { formatDate, formatDateTime, formatNumber } from '../../../lib/format';
import { qaState } from '../../../lib/qa';
import { routeOr } from '../../../lib/routes';
import type { MemberWrapped, MemberWrappedCard } from '../types';

/**
 * ADM-10 tab "Wrapped" (M5.9e admin, m5.9e contract §2): the member's generated seasons, a season picker with "Vorschau erzeugen"
 * (support.reply; GenerateWrappedForUser, audited) and the chosen season's cards as the member reads them, each with its 1080 × 1920
 * PNG from the staff-only card route. Opening a season is audited once a day (wrapped.viewed). Switching the season reloads only this
 * prop; a failed load or generation shows its error with a retry, the rest of the record stays.
 */
const props = defineProps<{ wrapped: MemberWrapped; memberId: string }>();

const season = ref(props.wrapped.selected);
watch(
    () => props.wrapped.selected,
    (selected) => (season.value = selected),
);

const loading = ref(false);
const loadFailed = ref(false);
const generating = ref(false);
const generateError = ref<string | null>(null);

function seasonLabel(key: string): string {
    const [year, kind] = key.split('-');
    return trans(`members.wrapped.seasons.${kind === 'jahr' ? 'jahr' : 'saison'}`, { year: year ?? '' });
}

const options = computed(() => props.wrapped.options.map((key) => ({ value: key, label: seasonLabel(key) })));

function load(key: string): void {
    loadFailed.value = false;
    generateError.value = null;
    router.get(
        window.location.pathname,
        { tab: 'wrapped', season: key },
        {
            only: ['wrapped'],
            preserveState: true,
            preserveScroll: true,
            replace: true,
            onStart: () => (loading.value = true),
            onFinish: () => (loading.value = false),
            onNetworkError: () => {
                loadFailed.value = true;
                return false;
            },
            onHttpException: () => {
                loadFailed.value = true;
                return false;
            },
        },
    );
}

const seasonModel = computed({
    get: () => season.value,
    set: (key: string) => {
        if (key === season.value) return;
        season.value = key;
        load(key);
    },
});

const page = usePage();

/** ⚿ (ADR-215): with a stale confirmation the password dialog comes first, then the write. */
function generate(): void {
    generateError.value = null;
    if (passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) send();
    else confirmPasswordFirst(send);
}

function send(): void {
    router.post(
        routeOr('admin.members.wrapped.generate', `/admin/members/${props.memberId}/wrapped`, { member: props.memberId }),
        { season_key: season.value },
        {
            preserveScroll: true,
            preserveState: true,
            onStart: () => (generating.value = true),
            onFinish: () => (generating.value = false),
            onError: (errors) => (generateError.value = Object.values(errors)[0] ?? trans('members.wrapped.generate_failed')),
            onNetworkError: () => {
                generateError.value = trans('members.wrapped.generate_failed');
                return false;
            },
            onHttpException: () => {
                generateError.value = trans('members.wrapped.generate_failed');
                return false;
            },
        },
    );
}

// ?qaState=empty (outside production, the visual matrix): the tab as for a member without any Wrapped.
const forcedEmpty = qaState() === 'empty';
const seasons = computed(() => (forcedEmpty ? [] : props.wrapped.seasons));
const preview = computed(() => (forcedEmpty ? null : props.wrapped.preview));

/** DQ-P5G-50: a sample opens outside production without a release date; the pill says so instead of contradicting "Kein Termin". */
const opensLabel = computed(() => {
    if (preview.value === null || !preview.value.opens) return 'members.wrapped.closed';
    const row = props.wrapped.seasons.find((item) => item.key === preview.value?.season_key);
    return preview.value.is_sample && row?.released !== true ? 'members.wrapped.opens_sample' : 'members.wrapped.opens';
});

// ---- card fields ------------------------------------------------------------------------------------------------------------------
/**
 * Fields that say nothing to a person reading the card (the metric is always the Build Score; the rule key repeats the title) or are
 * machine data the PNG thumbnail already shows (the share card's QR as SVG markup, a stored photo id). Photos stay a Vorhanden/Keins
 * line: the thumbnail opens the whole card with the photo on it.
 */
const HIDDEN = new Set(['metric', 'key', 'qr_svg', 'media_id']);
const PHOTO = new Set(['before_media', 'after_media', 'image']);

interface Line {
    key: string;
    label: string;
    value: string;
    numeric: boolean;
}

function rarest(value: Record<string, unknown>): string {
    const parts = [
        typeof value.vehicle_name === 'string' ? value.vehicle_name : '',
        typeof value.rarity === 'string' ? trans(`members.wrapped.rarity.${value.rarity}`) : '',
        typeof value.dex_number === 'number' ? trans('members.wrapped.dex', { number: String(value.dex_number).padStart(4, '0') }) : '',
    ];
    return parts.filter((part) => part !== '').join(' · ');
}

function lines(card: MemberWrappedCard): Line[] {
    return Object.entries(card.fields)
        .filter(([key]) => !HIDDEN.has(key))
        .map(([key, value]) => {
            const label = trans(`members.wrapped.fields.${key}`);
            if (PHOTO.has(key)) return { key, label, value: trans(value === true ? 'members.wrapped.photo_yes' : 'members.wrapped.photo_no'), numeric: false };
            if (key === 'dex_number' && typeof value === 'number') return { key, label, value: trans('members.wrapped.dex', { number: String(value).padStart(4, '0') }), numeric: true };
            if (typeof value === 'number') return { key, label, value: formatNumber(value), numeric: true };
            if (typeof value === 'string') return { key, label, value: value === '' ? '–' : value, numeric: false };
            if (Array.isArray(value)) return { key, label, value: value.length === 0 ? '–' : value.map(String).join(' · '), numeric: false };
            if (value !== null && typeof value === 'object') return { key, label, value: rarest(value as Record<string, unknown>), numeric: false };
            return { key, label, value: '–', numeric: false };
        });
}

const kindLabel = (kind: string): string => {
    const key = `members.wrapped.kinds.${kind}`;
    const text = trans(key);
    return text === key ? kind : text;
};

// PNGs that did not load (a GD failure, a session that ran out): the cell says so instead of a broken image.
const broken = ref<Set<number>>(new Set());
watch(preview, () => (broken.value = new Set()));
function imageFailed(n: number): void {
    broken.value = new Set([...broken.value, n]);
}
</script>

<template>
    <div class="flex flex-col gap-24" data-testid="ADM-10.wrapped">
        <!-- season picker + generate -->
        <section class="flex flex-col gap-8" aria-labelledby="adm10-wrapped-picker">
            <h3 id="adm10-wrapped-picker" class="sr-only">{{ trans('members.wrapped.season') }}</h3>
            <div class="flex flex-wrap items-end gap-12">
                <div class="w-240">
                    <Field :label="trans('members.wrapped.season')">
                        <Select v-model="seasonModel" :options="options" :disabled="loading || generating" data-testid="ADM-10.wrapped.season" />
                    </Field>
                </div>
                <Button v-if="wrapped.can.generate" variant="secondary" :icon="PhArrowsClockwise" :loading="generating" :disabled="loading" data-testid="ADM-10.wrapped.generate" @click="generate">
                    {{ trans('members.wrapped.generate') }}
                </Button>
            </div>
            <p v-if="wrapped.can.generate" class="max-w-720 text-caption text-ink-3">{{ trans('members.wrapped.generate_hint') }}</p>
            <p v-else class="flex items-center gap-8 text-caption text-ink-3" data-testid="ADM-10.wrapped.view-only">
                <PhLockSimple :size="16" aria-hidden="true" />{{ trans('members.wrapped.view_only') }}
            </p>
            <StateBlock v-if="generateError" kind="error" :title="generateError" test-id="ADM-10.wrapped.generate-error" @retry="generate" />
        </section>

        <!-- the member's seasons -->
        <section class="flex flex-col gap-8" aria-labelledby="adm10-wrapped-seasons">
            <h3 id="adm10-wrapped-seasons" class="text-admin-base-strong text-ink">{{ trans('members.wrapped.seasons_title') }}</h3>
            <EmptyQueue v-if="seasons.length === 0" variant="quiet" compact :title="trans('members.wrapped.seasons_empty')" data-testid="ADM-10.wrapped.seasons-empty" />
            <ScrollRegion v-else :label="trans('members.wrapped.seasons_caption')" test-id="ADM-10.wrapped.seasons">
                <table class="w-full border-collapse text-admin-base">
                    <caption class="sr-only">{{ trans('members.wrapped.seasons_caption') }}</caption>
                    <thead>
                        <tr class="h-40 border-b border-line text-left text-caption text-ink-2">
                            <th scope="col" class="px-12">{{ trans('members.wrapped.columns.season') }}</th>
                            <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.wrapped.columns.generated') }}</th>
                            <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.wrapped.columns.viewed') }}</th>
                            <th scope="col" class="w-px whitespace-nowrap px-12 text-right">{{ trans('members.wrapped.columns.shared') }}</th>
                            <th scope="col" class="w-px whitespace-nowrap px-12">{{ trans('members.wrapped.columns.release') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in seasons" :key="row.key" class="h-40 border-b border-line-subtle last:border-b-0" :aria-current="row.key === season ? 'true' : undefined" data-testid="ADM-10.wrapped.season-row">
                            <td class="px-12">
                                <span class="flex items-center gap-8">
                                    <button
                                        type="button"
                                        :class="[focusRing, 'inline-flex min-h-32 items-center rounded-xs text-ink hover:underline', row.key === season ? 'text-admin-base-strong' : '']"
                                        :aria-label="trans('members.wrapped.open_season', { season: seasonLabel(row.key) })"
                                        :disabled="loading || generating"
                                        @click="seasonModel = row.key"
                                    >
                                        {{ seasonLabel(row.key) }}
                                    </button>
                                    <Badge v-if="row.is_sample">{{ trans('members.wrapped.sample') }}</Badge>
                                </span>
                            </td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ formatDateTime(row.generated_at) }}</td>
                            <td class="whitespace-nowrap px-12 text-ink-2 tabular-nums">{{ row.viewed_at ? formatDateTime(row.viewed_at) : trans('members.wrapped.never') }}</td>
                            <td class="px-12 text-right text-ink tabular-nums">{{ formatNumber(row.shared_count) }}</td>
                            <td class="whitespace-nowrap px-12">
                                <StatusPill v-if="row.released" tone="success" :label="trans('members.wrapped.released')" />
                                <span v-else-if="row.release_at" class="text-ink-2 tabular-nums">{{ trans('members.wrapped.planned', { date: formatDateTime(row.release_at) }) }}</span>
                                <span v-else class="text-ink-3">{{ trans('members.wrapped.no_release') }}</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </ScrollRegion>
        </section>

        <!-- the chosen season -->
        <section class="flex flex-col gap-12" aria-labelledby="adm10-wrapped-preview" :aria-busy="loading || generating ? 'true' : undefined">
            <h3 id="adm10-wrapped-preview" class="text-admin-base-strong text-ink">{{ trans('members.wrapped.preview_title', { season: seasonLabel(season) }) }}</h3>

            <StateBlock v-if="loadFailed" kind="error" :title="trans('members.wrapped.load_failed')" :body="trans('ui.state.error_body')" test-id="ADM-10.wrapped.error" @retry="load(season)" />
            <div v-else-if="loading" class="flex flex-col gap-12" data-testid="ADM-10.wrapped.loading">
                <Skeleton shape="text" class="w-320" />
                <div v-for="n in 3" :key="n" class="flex gap-16 border-b border-line-subtle pb-12">
                    <Skeleton class="aspect-9/16 w-72 shrink-0 rounded-sm" />
                    <div class="flex flex-1 flex-col gap-8">
                        <Skeleton shape="text" class="w-120" />
                        <Skeleton shape="text" class="w-240" />
                        <Skeleton shape="text" class="w-200" />
                    </div>
                </div>
            </div>
            <EmptyQueue
                v-else-if="preview === null"
                variant="first"
                :title="trans('members.wrapped.empty_title')"
                :body="trans(wrapped.can.generate ? 'members.wrapped.empty_body' : 'members.wrapped.empty_body_view_only')"
                data-testid="ADM-10.wrapped.empty"
            />
            <template v-else>
                <p class="flex flex-wrap items-center gap-8 text-admin-base text-ink-2 tabular-nums" data-testid="ADM-10.wrapped.meta">
                    <span>{{ trans('members.wrapped.window', { from: formatDate(preview.window.from), to: formatDate(preview.window.to) }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ trans('members.wrapped.generated_at', { date: formatDateTime(preview.generated_at) }) }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ trans('members.wrapped.cards_count', { count: formatNumber(preview.cards.length) }) }}</span>
                    <StatusPill :tone="preview.opens ? 'success' : 'neutral'" :label="trans(opensLabel)" data-testid="ADM-10.wrapped.opens" />
                    <Badge v-if="preview.is_sample">{{ trans('members.wrapped.sample') }}</Badge>
                </p>

                <ol class="flex flex-col" :aria-label="trans('members.wrapped.cards_caption')" data-testid="ADM-10.wrapped.cards">
                    <li v-for="card in preview.cards" :key="card.n" class="flex gap-16 border-b border-line-subtle py-12 last:border-b-0" :data-kind="card.kind" data-testid="ADM-10.wrapped.card">
                        <a
                            v-if="!broken.has(card.n)"
                            :href="card.image"
                            target="_blank"
                            rel="noopener"
                            :class="[focusRing, 'block w-72 shrink-0 self-start overflow-hidden rounded-sm border border-line bg-canvas']"
                            :aria-label="trans('members.wrapped.open_image', { n: String(card.n) })"
                            data-testid="ADM-10.wrapped.card-image"
                        >
                            <img :src="card.image" alt="" width="72" height="128" loading="lazy" decoding="async" class="aspect-9/16 w-72 object-cover" @error="imageFailed(card.n)" />
                        </a>
                        <div v-else class="flex aspect-9/16 w-72 shrink-0 flex-col items-center justify-center gap-4 self-start rounded-sm border border-dashed border-line px-4 text-center text-caption text-ink-3" data-testid="ADM-10.wrapped.card-image-failed">
                            <PhImageBroken :size="20" aria-hidden="true" />{{ trans('members.wrapped.image_failed') }}
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col gap-8">
                            <p class="flex items-baseline gap-8">
                                <span class="text-caption text-ink-3 tabular-nums">{{ trans('members.wrapped.card_position', { n: String(card.n) }) }}</span>
                                <span class="text-admin-base-strong text-ink">{{ kindLabel(card.kind) }}</span>
                            </p>
                            <dl class="flex flex-col gap-4 text-admin-base">
                                <div v-for="line in lines(card)" :key="line.key" class="flex flex-col tablet:flex-row tablet:gap-16">
                                    <dt class="shrink-0 text-ink-2 tablet:w-160">{{ line.label }}</dt>
                                    <dd :class="['min-w-0 break-words text-ink', line.numeric ? 'tabular-nums' : '']">{{ line.value }}</dd>
                                </div>
                            </dl>
                        </div>
                    </li>
                </ol>
            </template>
        </section>
    </div>
</template>
