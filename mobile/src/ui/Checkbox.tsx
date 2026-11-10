import { SelectionControl, type SelectionControlProps } from './SelectionControl';

export type CheckboxProps = SelectionControlProps;

/** Role checkbox with `aria-checked`. Set `showLabel` for a full row with text. */
export function Checkbox(props: CheckboxProps) {
  return <SelectionControl shape="checkbox" {...props} />;
}
