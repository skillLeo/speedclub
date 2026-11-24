<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { toast } from '../ui/toast';
import ApprovalNotice from '../patterns/ApprovalNotice.vue';
import { askToRepeatLastWrite } from '../../composables/recentPassword';
import { flashText } from '../../lib/i18n';
import type { ApprovalFlash, SharedFlash } from '../../types/inertia';

/**
 * Turns the shared `flash` of each response into UI: success/error toasts, the four-eyes notice, the password dialog. Only on
 * responses, never on history navigation, so a flash is not shown twice. ADR-540: an approval flash marked `direct` (four-eyes off, the
 * action ran at once) is a toast, never the waiting notice: "Ausgeführt" or the refusal with its reason.
 */
const page = usePage();
const approval = ref<ApprovalFlash | null>(null);
let off: (() => void) | undefined;
/** The layout may mount during the visit whose `success` event follows: each flash object is handled once. */
const handled = new WeakSet<object>();

function handle(flash: SharedFlash | undefined): void {
    if (flash === undefined || handled.has(flash)) return;
    handled.add(flash);
    if (flash.success) toast('success', flashText(flash.success, trans));
    if (flash.error) toast('error', flashText(flash.error, trans));
    if (flash.approval?.direct === true) {
        const title = flashText(flash.approval.title, trans);
        if (flash.approval.status === 'failed') toast('error', trans('ui.approval.direct_failed', { title, error: flash.approval.error ?? trans('ui.state.server_error') }));
        else if (!flash.success) toast('success', trans('ui.approval.direct_done', { title }));
    } else if (flash.approval) approval.value = flash.approval;
    if (flash.confirm_password) askToRepeatLastWrite();
}

onMounted(() => {
    handle(page.props.flash);
    let component = page.component;
    off = router.on('success', (event) => {
        if (event.detail.page.component !== component) approval.value = null;
        component = event.detail.page.component;
        handle(event.detail.page.props.flash);
    });
});
onBeforeUnmount(() => off?.());
</script>

<template>
    <ApprovalNotice v-if="approval" :approval="approval" dismissible test-id="shell.approval" class="mb-24" @dismiss="approval = null" />
</template>
