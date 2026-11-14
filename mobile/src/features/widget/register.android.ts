/**
 * Android widget "Mein Auto" (09 §8.14, ADR-454), registered from the app's entry (mobile/index.ts): the headless task the
 * launcher calls, and the sync that writes the snapshot and pushes each change to the placed widgets.
 */
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';

import { qaForcesFlag } from '@/lib/qa';
import { queryClient } from '@/api/queryClient';
import i18n from '@/i18n';
import { getDisplayUnits } from '@/lib/displayUnits';
import { toFormatLocale } from '@/lib/useFormat';
import { useSessionStore } from '@/state/session';

import { ensureWidgetPhoto } from './photo';
import { meinAutoTaskHandler, renderMeinAuto, sizeOf } from './render';
import { WIDGET_NAME, type WidgetSnapshot } from './snapshot';
import { prunePhotos, readSnapshot, removeWidgetFiles, writeSnapshot } from './store';
import { startWidgetSync } from './sync';

let registered = false;

function publish(snapshot: WidgetSnapshot | null): Promise<void> {
  return requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: (info) => renderMeinAuto(sizeOf(info), snapshot, new Date()),
  });
}

export function registerWidget(): void {
  if (registered) return;
  registered = true;
  registerWidgetTaskHandler((props) => meinAutoTaskHandler(props));
  startWidgetSync({
    queryClient,
    session: useSessionStore,
    translate: () => {
      const locale = toFormatLocale(i18n.language);
      return { t: i18n.getFixedT(locale, 'garage'), locale };
    },
    unit: () => getDisplayUnits().distance,
    qaForcesFlag,
    read: readSnapshot,
    write: writeSnapshot,
    clearAll: () => removeWidgetFiles(),
    prunePhotos,
    photo: (media, previous) => ensureWidgetPhoto(media, previous),
    publish,
  });
}
