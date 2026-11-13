<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { PhShieldWarning, PhX } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, onMounted, ref } from 'vue';
import Button from '../ui/Button.vue';
import IconButton from '../ui/IconButton.vue';
import { routeOr } from '../../lib/routes';

/**
 * Reminder for a session that skipped ADM-03 (STAFF_2FA_REQUIRED=false, shared prop staff.two_factor_skipped). It stays on every page
 * until TOTP is confirmed; hiding it lasts for this browser session only (sessionStorage, a per-viewer convenience).
 */
const page = usePage();
const staff = computed(() => page.props.staff);
const storageKey = computed(() => `sc.admin.two-factor-reminder.${staff.value?.id ?? 'unknown'}`);
const hidden = ref(false);
const setupUrl = routeOr('admin.two-factor.setup', '/admin/two-factor/setup');

onMounted(() => {
    try {
        hidden.value = window.sessionStorage.getItem(storageKey.value) === '1';
    } catch {
        hidden.value = false;
    }
});

function dismiss(): void {
    hidden.value = true;
    try {
        window.sessionStorage.setItem(storageKey.value, '1');
    } catch {
        // Without storage it is hidden until the next full load.
    }
}

const visible = computed(() => staff.value?.two_factor_skipped === true && !hidden.value);
</script>

<template>
    <section v-if="visible" class="mb-16 flex flex-wrap items-center gap-12 rounded-sm border border-line bg-raised px-16 py-12" :aria-label="trans('shell.two_factor.reminder_label')" data-testid="shell.two-factor-reminder">
        <PhShieldWarning :size="20" class="shrink-0 text-warning" aria-hidden="true" />
        <p class="min-w-0 flex-1 text-admin-base text-ink">{{ trans('shell.two_factor.reminder') }}</p>
        <div class="flex items-center gap-8">
            <Button size="sm" variant="secondary" :href="setupUrl" data-testid="shell.two-factor-reminder.setup">{{ trans('shell.two_factor.reminder_link') }}</Button>
            <IconButton :icon="PhX" :label="trans('shell.two_factor.reminder_dismiss')" data-testid="shell.two-factor-reminder.dismiss" @click="dismiss" />
        </div>
    </section>
</template>
