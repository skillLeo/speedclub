export interface SelectOption<V extends string = string> {
    value: V;
    label: string;
    disabled?: boolean;
}
