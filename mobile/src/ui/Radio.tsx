import { SelectionControl, type SelectionControlProps } from './SelectionControl';

export type RadioProps = SelectionControlProps;

/** Role radio with `aria-checked`; `onChange` always receives true. Group them in a View with role radiogroup. */
export function Radio(props: RadioProps) {
  return <SelectionControl shape="radio" {...props} />;
}
