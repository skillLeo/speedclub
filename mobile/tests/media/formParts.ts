/** The fields of a FormData, whichever implementation the test environment has (Node's, or React Native's `_parts`). */
export function partsOf(form: FormData): Record<string, unknown> {
  const native = (form as unknown as { _parts?: [string, unknown][] })._parts;
  if (native) return Object.fromEntries(native);
  return Object.fromEntries((form as unknown as { entries: () => Iterable<[string, unknown]> }).entries());
}
