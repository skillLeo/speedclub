/**
 * The words around a target's language-free label (m2.6-api-handover §2): "Foto von Audi RS6 Avant C8", "Nachricht von @paul.roadster".
 * A member and a vehicle are their label; an empty label is a name that is gone.
 */
import type { TFunction } from 'i18next';

import { handleText, nameInText } from '@/ui/textBreaks';

import type { SafetyTargetRef } from './model';

/**
 * DQ-926: a label as a sentence sets it. A handle breaks only after its "." or "_"; a vehicle or mod name never at its own
 * hyphen ("GT-R", "Slip-On"), with its trailing code bound (ADR-426 c).
 */
export function labelText(label: string): string {
  return /^@\S+$/.test(label) ? handleText(label) : nameInText(label);
}

/**
 * The target as a sentence words it ("Foto von {{label}}"). `label` sets the name: labelText for a plain string, or a SlotText
 * `slot()` where the surface takes a node, so the name sits in its own span that never hyphenates (NH-R4-2).
 */
export function targetLabel(t: TFunction<'safety'>, target: SafetyTargetRef, label: (name: string) => string = labelText): string {
  if (!target.label) return t('targetLabels.gone');
  const name = label(target.label);
  switch (target.type) {
    case 'member':
    case 'vehicle':
      return name;
    case 'photo':
    case 'message':
    case 'build_update':
    case 'modification':
    case 'comment':
    case 'event':
      return t(`targetLabels.${target.type}`, { label: name });
  }
}
