<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhCheckCircle, PhCircleDashed, PhPlay } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Skeleton } from '../../Components/ui';
import { usePageState } from '../../composables/pageState';
import { formatDateTime } from '../../lib/format';
import { routeOr } from '../../lib/routes';

/**
 * ADM-50 integrations (06 §3 System: "status only, never show secrets"): each service as set up or not, with the driver or provider name
 * where harmless; never a key, host, user, token or address. Test buttons: e-mail to me, Pusher event, AI call (the stand-in without a
 * key); the push test stays disabled with its reason (staff register no device). The last test's outcome comes back as a flash value.
 */
interface Integration {
    key: string;
    configured: boolean;
    driver: string | null;
    test: { available: boolean; reason: string | null };
}
const props = defineProps<{ integrations: Integration[]; lastTest: { key: string; ok: boolean; error: string | null; faked: boolean; at: string } | null }>();

const failed = ref(false);
const state = usePageState(() => (failed.value ? 'error' : 'ready'));
const testing = ref<string | null>(null);
const TESTABLE = ['mail', 'pusher', 'push', 'ai'];
const rows = computed(() => props.integrations);
function test(key: string): void {
    router.post(routeOr('admin.system.integrations.test', `/admin/system/integrations/${key}/test`, { integration: key }), {}, {
        preserveScroll: true,
        onStart: () => (testing.value = key),
        onFinish: () => (testing.value = null),
        onNetworkError: () => {
            failed.value = true;
            return false;
        },
    });
}
function lastText(key: string): string | null {
    const last = props.lastTest;
    if (last === null || last.key !== key) return null;
    if (!last.ok) return trans('system.integrations.last_failed', { date: formatDateTime(last.at), error: last.error ?? '–' });
    return trans(last.faked ? 'system.integrations.last_ok_faked' : 'system.integrations.last_ok', { date: formatDateTime(last.at) });
}
</script>

<template>
    <Head :title="trans('system.integrations.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-50" :data-qa-state="state">
        <PageHeader :title="trans('system.integrations.title')" :crumbs="[{ label: trans('shell.groups.system') }]" :description="trans('system.integrations.intro')" />

        <StateBlock v-if="state === 'error'" kind="error" :title="trans('system.integrations.error')" :body="trans('ui.state.error_body')" test-id="ADM-50.error" @retry="router.reload()" />
        <ul v-else class="flex flex-col rounded-sm border border-line-subtle" :aria-busy="state === 'loading' || undefined" data-testid="ADM-50.list">
            <template v-if="state === 'loading'">
                <li v-for="n in 6" :key="n" class="flex min-h-64 flex-wrap items-center gap-x-24 gap-y-8 border-b border-line-subtle px-16 py-12 last:border-b-0">
                    <span class="flex min-w-240 flex-1 flex-col gap-4"><Skeleton shape="text" class="w-160" /><Skeleton shape="text" class="w-320" /></span>
                    <Skeleton shape="text" class="w-120" /><Skeleton class="h-32 w-160" />
                </li>
            </template>
            <li v-for="item in rows" v-else :key="item.key" class="flex min-h-64 flex-wrap items-center gap-x-24 gap-y-8 border-b border-line-subtle px-16 py-12 last:border-b-0" :data-testid="`ADM-50.item.${item.key}`">
                <span class="flex min-w-240 flex-1 flex-col gap-2">
                    <span class="text-admin-base-strong text-ink">{{ trans(`system.integrations.keys.${item.key}.name`) }}</span>
                    <span class="text-admin-base text-ink-3">{{ trans(`system.integrations.keys.${item.key}.about`) }}</span>
                    <span v-if="lastText(item.key)" class="text-admin-base tabular-nums" :class="lastTest?.ok ? 'text-ink-2' : 'text-danger'" :data-testid="`ADM-50.last.${item.key}`">{{ lastText(item.key) }}</span>
                </span>
                <span class="flex w-200 flex-col gap-2">
                    <span class="inline-flex items-center gap-4 text-admin-base" :class="item.configured ? 'text-ink' : 'text-ink-3'" :data-testid="`ADM-50.state.${item.key}`">
                        <PhCheckCircle v-if="item.configured" :size="16" class="text-success" aria-hidden="true" />
                        <PhCircleDashed v-else :size="16" aria-hidden="true" />
                        {{ item.configured ? trans('system.integrations.configured') : trans('system.integrations.not_configured') }}
                    </span>
                    <span v-if="item.driver" class="sc-key text-caption text-ink-3">{{ trans(item.key === 'ai' ? 'system.integrations.provider' : 'system.integrations.driver', { driver: item.driver }) }}</span>
                </span>
                <span class="flex w-280 flex-col items-start gap-2">
                    <Button
                        v-if="TESTABLE.includes(item.key)"
                        size="sm"
                        variant="secondary"
                        :icon="PhPlay"
                        :disabled="!item.test.available || (testing !== null && testing !== item.key)"
                        :loading="testing === item.key"
                        :aria-describedby="!item.test.available && item.test.reason ? `adm50-reason-${item.key}` : undefined"
                        :data-testid="`ADM-50.test.${item.key}`"
                        @click="test(item.key)"
                    >
                        {{ trans(`system.integrations.keys.${item.key}.test`) }}
                    </Button>
                    <span v-if="!item.test.available && item.test.reason" :id="`adm50-reason-${item.key}`" class="text-admin-base text-ink-3">{{ trans(`system.integrations.reasons.${item.test.reason}`) }}</span>
                </span>
            </li>
        </ul>
    </div>
</template>
