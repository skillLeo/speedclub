import { typography, type TypeVariant } from './tokens.generated';

/**
 * The type roles that carry their own size. `numeric.inline` has none: it takes the size of the text it sits in (09 §4.2),
 * so anything that measures a role (skeleton lines, line boxes, the gallery specimen) takes only these.
 */
export type SizedTypeVariant = {
  [K in TypeVariant]: (typeof typography)[K] extends { fontSize: number } ? K : never;
}[TypeVariant];

export type SizedRole = { fontSize: number; lineHeight: number; letterSpacing: number };

export function isSizedVariant(variant: TypeVariant): variant is SizedTypeVariant {
  return 'fontSize' in typography[variant];
}

/** Size, line height and tracking of a role; a role without a size (numeric.inline) measures as body. */
export function sizedRole(variant: TypeVariant): SizedRole {
  const role = typography[isSizedVariant(variant) ? variant : 'body'];
  return { fontSize: role.fontSize, lineHeight: role.lineHeight, letterSpacing: role.letterSpacing };
}
