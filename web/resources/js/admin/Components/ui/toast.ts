import { reactive } from 'vue';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
    id: number;
    tone: ToastTone;
    title: string;
    description?: string;
}

/** Own toast queue (token-styled, no third-party CSS). At most 3 visible; errors stay until dismissed. */
export const toasts = reactive<ToastItem[]>([]);
let next = 1;

export function toast(tone: ToastTone, title: string, description?: string): number {
    const id = next++;
    toasts.push({ id, tone, title, description });
    while (toasts.length > 3) toasts.shift();
    if (tone !== 'error') window.setTimeout(() => dismissToast(id), 6000);
    return id;
}

export function dismissToast(id: number): void {
    const index = toasts.findIndex((item) => item.id === id);
    if (index !== -1) toasts.splice(index, 1);
}
