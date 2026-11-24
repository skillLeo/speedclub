<script setup lang="ts">
import { PhFloppyDisk } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { useAdminAction } from '../../../Components/decisions/action';
import { Badge, Button, ConfirmDialog, RadioGroup, Switch } from '../../../Components/ui';
import { formatNumber } from '../../../lib/format';
import { routeOr } from '../../../lib/routes';

/**
 * ADM-52 Governance › Einstellungen (M5.1 ADR-507, ADR-540). Three switches of the config key `governance`, saved together:
 * - "Vier-Augen-Prinzip" (default off, client decision 2026-11-23): off runs every action that would ask for an approval at once,
 *   audited as a direct action; on, they wait for a second person as before.
 * - "2FA für Admin-Konten" Pflicht / Optional (default Optional): Optional lets each staff member sign in without TOTP and switch their
 *   own off in ADM-51. `two_factor_forced`: the deployment (STAFF_2FA_REQUIRED=true) holds it at Pflicht.
 * - the Owner-Override (only meaningful while four-eyes is on) and who can approve today.
 * Owner only (recent password, no reason); an Admin reads it.
 */
type Mode = 'required' | 'optional';
const props = defineProps<{
    governance: { owner_override: boolean; four_eyes: boolean; staff_two_factor: Mode; two_factor_forced: boolean; approvers: { id: number; name: string; owner: boolean }[] };
    canEdit: boolean;
}>();

const override = ref(props.governance.owner_override);
const fourEyes = ref(props.governance.four_eyes);
const twoFactor = ref<Mode>(props.governance.staff_two_factor);
watch(
    () => props.governance,
    (next) => {
        override.value = next.owner_override;
        fourEyes.value = next.four_eyes;
        twoFactor.value = next.staff_two_factor;
    },
);
const changed = computed(() => override.value !== props.governance.owner_override || fourEyes.value !== props.governance.four_eyes || twoFactor.value !== props.governance.staff_two_factor);
const alone = computed(() => props.governance.approvers.length < 2);
const twoFactorOptions = computed(() => [
    { value: 'optional', label: trans('settings.governance.two_factor_optional'), hint: trans('settings.governance.two_factor_optional_hint') },
    { value: 'required', label: trans('settings.governance.two_factor_required'), hint: trans('settings.governance.two_factor_required_hint') },
]);

/** What the confirmation says: one sentence per switch that changes. */
const summary = computed(() =>
    [
        fourEyes.value !== props.governance.four_eyes ? trans(fourEyes.value ? 'settings.governance.confirm_four_eyes_on' : 'settings.governance.confirm_four_eyes_off') : null,
        twoFactor.value !== props.governance.staff_two_factor ? trans(twoFactor.value === 'required' ? 'settings.governance.confirm_two_factor_required' : 'settings.governance.confirm_two_factor_optional') : null,
        override.value !== props.governance.owner_override ? trans(override.value ? 'settings.governance.confirm_on' : 'settings.governance.confirm_off') : null,
    ]
        .filter((line): line is string => line !== null)
        .join(' '),
);

const action = useAdminAction();
const confirmOpen = ref(false);
function save(): void {
    action.run(
        'patch',
        routeOr('admin.settings.governance', '/admin/settings/governance'),
        { owner_override: override.value, four_eyes: fourEyes.value, staff_two_factor: twoFactor.value },
        { sensitive: true, onSuccess: () => (confirmOpen.value = false) },
    );
}
</script>

<template>
    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm52-governance" data-testid="ADM-52.governance">
        <div class="flex flex-wrap items-start justify-between gap-12">
            <div class="flex min-w-0 flex-col gap-4">
                <h2 id="adm52-governance" class="text-headline text-ink">{{ trans('settings.governance.title') }}</h2>
                <p class="max-w-720 text-admin-base text-ink-2">{{ trans('settings.governance.intro') }}</p>
            </div>
            <Button v-if="canEdit" size="sm" variant="primary" :icon="PhFloppyDisk" :disabled="!changed" data-testid="ADM-52.governance.save" @click="(action.reset(), (confirmOpen = true))">{{ trans('settings.save') }}</Button>
        </div>

        <div class="flex flex-col gap-4">
            <Switch v-model="fourEyes" :label="trans('settings.governance.four_eyes')" :disabled="!canEdit" data-testid="ADM-52.governance.four-eyes" />
            <p class="max-w-720 text-admin-base text-ink-3">{{ trans(fourEyes ? 'settings.governance.four_eyes_on_hint' : 'settings.governance.four_eyes_off_hint') }}</p>
        </div>

        <div class="flex flex-col gap-4" data-testid="ADM-52.governance.two-factor">
            <RadioGroup v-model="twoFactor" :options="twoFactorOptions" :legend="trans('settings.governance.two_factor')" :disabled="!canEdit || governance.two_factor_forced" />
            <p v-if="governance.two_factor_forced" class="max-w-720 text-admin-base text-ink-3" role="note" data-testid="ADM-52.governance.two-factor-forced">{{ trans('settings.governance.two_factor_forced') }}</p>
        </div>

        <template v-if="fourEyes">
            <div class="flex flex-col gap-4">
                <Switch v-model="override" :label="trans('settings.governance.owner_override')" :disabled="!canEdit" data-testid="ADM-52.governance.switch" />
                <p class="max-w-720 text-admin-base text-ink-3">{{ trans('settings.governance.owner_override_hint') }}</p>
            </div>
            <div class="flex flex-col gap-8" data-testid="ADM-52.governance.approvers">
                <p class="text-admin-base-strong text-ink">{{ transChoice('settings.governance.approvers', governance.approvers.length, { count: formatNumber(governance.approvers.length) }) }}</p>
                <ul v-if="governance.approvers.length > 0" class="flex flex-wrap gap-8">
                    <li v-for="person in governance.approvers" :key="person.id" class="flex items-center gap-8 text-admin-base text-ink">
                        {{ person.name }}<Badge v-if="person.owner" tone="neutral">{{ trans('settings.governance.owner') }}</Badge>
                    </li>
                </ul>
                <p v-if="alone && governance.four_eyes" class="text-admin-base text-warning" role="note" data-testid="ADM-52.governance.alone">
                    {{ governance.owner_override ? trans('settings.governance.alone_on') : trans('settings.governance.alone_off') }}
                </p>
            </div>
        </template>

        <ConfirmDialog
            v-model:open="confirmOpen"
            :title="trans('settings.governance.confirm_title')"
            :body="summary"
            :confirm-label="trans('settings.save')"
            tone="neutral"
            :processing="action.processing.value"
            :error="action.error.value"
            test-id="ADM-52.governance.confirm"
            @confirm="save"
        />
    </section>
</template>
