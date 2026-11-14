/**
 * Android widget "Mein Auto": the snapshot drawn for one placed widget, in the language it was written in (the empty state in the
 * device's language). Used by the headless task handler (the launcher asks) and by the app's push (the data changed).
 */
import type { WidgetInfo, WidgetTaskHandlerProps } from 'react-native-android-widget';

import { UPCOMING_DAYS } from '@/api/queries/maintenance';
import i18n, { detectLocale } from '@/i18n';
import { berlinDay } from '@/features/maintenance/schemas';

import { meinAutoTrees, widgetModel, type WidgetSize } from './MeinAutoWidget';
import { WIDGET_NAME, type WidgetSnapshot } from './snapshot';
import { fileExists, readSnapshot } from './store';

export function sizeOf(info: Pick<WidgetInfo, 'width' | 'height' | 'screenInfo'>): WidgetSize {
  return { width: info.width, height: info.height, fontScale: info.screenInfo.fontScale };
}

/** A photo file that is gone (an app data reset) leaves the pane dark instead of a broken image. */
function withExistingPhoto(snapshot: WidgetSnapshot | null, exists: (uri: string) => boolean): WidgetSnapshot | null {
  const photo = snapshot?.car?.photo;
  if (!snapshot?.car || !photo || exists(photo.uri)) return snapshot;
  return { ...snapshot, car: { ...snapshot.car, photo: null } };
}

export function renderMeinAuto(size: WidgetSize, stored: WidgetSnapshot | null, now: Date, exists: (uri: string) => boolean = fileExists) {
  const snapshot = withExistingPhoto(stored, exists);
  const locale = snapshot?.locale ?? detectLocale();
  const t = i18n.getFixedT(locale, 'garage');
  const model = widgetModel(snapshot, { t, today: berlinDay(now) }, UPCOMING_DAYS);
  return meinAutoTrees(model, size, locale);
}

const DRAWN_ACTIONS: ReadonlySet<WidgetTaskHandlerProps['widgetAction']> = new Set(['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED']);

/**
 * The headless task: added, the 6-hourly update and a resize draw from the snapshot on disk. A tap needs no task (OPEN_URI opens
 * the app natively), and a removed widget has nothing to clean up.
 */
export async function meinAutoTaskHandler(props: WidgetTaskHandlerProps, read: () => Promise<WidgetSnapshot | null> = readSnapshot): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME || !DRAWN_ACTIONS.has(props.widgetAction)) return;
  props.renderWidget(renderMeinAuto(sizeOf(props.widgetInfo), await read(), new Date()));
}
