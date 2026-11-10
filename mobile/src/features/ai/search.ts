import type { InterpretationChip } from '@/api/queries/ai';

/**
 * The AI's chips as the search parameters DISC-02 reads (`make=bmw&wheel_diameter=19,20`): the facets are the filter parameters
 * themselves, several values of one facet join with a comma. The server already dropped what the catalogue and the facets do not know.
 */
export function aiChipParams(chips: readonly InterpretationChip[]): Record<string, string> {
  const params: Record<string, string[]> = {};
  for (const chip of chips) {
    const value = chip.value.trim();
    if (!value) continue;
    const values = (params[chip.facet] ??= []);
    if (!values.includes(value)) values.push(value);
  }
  return Object.fromEntries(Object.entries(params).map(([facet, values]) => [facet, values.join(',')]));
}
