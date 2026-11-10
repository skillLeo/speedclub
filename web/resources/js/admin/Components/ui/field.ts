import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';

export interface FieldContext {
    id: ComputedRef<string>;
    describedBy: ComputedRef<string | undefined>;
    invalid: ComputedRef<boolean>;
    required: ComputedRef<boolean>;
}

const key: InjectionKey<FieldContext> = Symbol('admin-field');

export function provideField(context: FieldContext): void {
    provide(key, context);
}

/** Inside a Field, a control takes its id, aria-describedby and invalid state from it unless set explicitly. */
export function useField(props: { id?: string; invalid?: boolean }) {
    const field = inject(key, null);

    return {
        id: computed(() => props.id ?? field?.id.value),
        describedBy: computed(() => field?.describedBy.value),
        invalid: computed(() => props.invalid === true || field?.invalid.value === true),
        required: computed(() => field?.required.value === true),
    };
}
