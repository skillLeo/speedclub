/**
 * The words around a target's language-free label (m2.6-api-handover §2): "Foto von Audi RS6 Avant C8", "Nachricht von @paul.roadster".
 * A member and a vehicle are their label; an empty label is a name that is gone.
 */
import type { TFunction } from 'i18next';

import type { SafetyTargetRef } from './model';

export function targetLabel(t: TFunction<'safety'>, target: SafetyTargetRef): string {
  if (!target.label) return t('targetLabels.gone');
  switch (target.type) {
    case 'member':
    case 'vehicle':
      return target.label;
    case 'photo':
    case 'message':
    case 'build_update':
    case 'modification':
      return t(`targetLabels.${target.type}`, { label: target.label });
  }
}
