import { router } from '@inertiajs/vue3';
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * ADR-217 idle timeout: the session lives 30 minutes from the last request. The client keeps a timer only (no background request):
 * warn at `warnMinutes`, and at `idleMinutes` reload the page, which lands on the sign-in with "Deine Sitzung ist abgelaufen".
 * Every Inertia request (and a keep-alive) restarts the clock.
 */
export function useIdle(idleMinutes: () => number, warnMinutes: () => number) {
    const warning = ref(false);
    const secondsLeft = ref(0);
    let last = Date.now();
    let timer: number | undefined;
    let off: (() => void) | undefined;

    function touch(): void {
        last = Date.now();
        warning.value = false;
    }

    function tick(): void {
        const elapsed = (Date.now() - last) / 1000;
        const idle = idleMinutes() * 60;
        secondsLeft.value = Math.max(0, Math.round(idle - elapsed));
        if (elapsed >= idle) {
            window.clearInterval(timer);
            timer = undefined;
            window.location.reload();
            return;
        }
        warning.value = elapsed >= warnMinutes() * 60;
    }

    onMounted(() => {
        off = router.on('finish', touch);
        timer = window.setInterval(tick, 1000);
    });

    onBeforeUnmount(() => {
        off?.();
        if (timer !== undefined) window.clearInterval(timer);
    });

    return { warning, secondsLeft, touch };
}
