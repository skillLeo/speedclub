/**
 * Member web (M5.12a, 09 §12): the owner's Car of the Day editor (a form with zod and React Hook Form) is its own chunk, loaded when the
 * owner first opens it, not with Start's first screen, which every guest and member downloads. Native has one bundle and imports it
 * directly (CarOfTheDayEditorLazy.native.tsx).
 */
import { lazy, Suspense, type ComponentProps } from 'react';

import type { CarOfTheDayEditor as Editor } from './CarOfTheDayEditor';

const LazyEditor = lazy(() => import('./CarOfTheDayEditor').then((module) => ({ default: module.CarOfTheDayEditor })));

export function CarOfTheDayEditorLazy(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={null}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
