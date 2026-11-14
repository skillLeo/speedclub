'use no memo';
/**
 * Android widget "Mein Auto" (09 §8.14, ADR-454): the light and the dark tree. react-native-android-widget turns these elements
 * into native views by calling the components as plain functions, so this file has no hooks and opts out of the React Compiler
 * (the library's own instruction), and every style object is built outside the JSX.
 *
 * Car: the photo pane (4:5 crop, dark media ground underneath while there is none; narrower or left out when the text needs the
 * width, layout.ts) and the panel on the theme's surface: the make
 * (label.caps), the name (Archivo SemiExpanded, display.wordmark), and the next due item: its label and countdown, overdue in the
 * accent, due within 30 days in the warning tone. A tap opens GAR-02 (`speedclub://garage/<id>`).
 * Empty (no car, signed out, or the flag off): a brand photo, one line of invitation and "Auto hinzufügen", which opens the wizard.
 */
import type { TFunction } from 'i18next';
import {
  FlexWidget,
  ImageWidget,
  TextWidget,
  type ColorProp,
  type FlexWidgetStyle,
  type ImageWidgetSource,
  type TextWidgetStyle,
} from 'react-native-android-widget';

import { countdownText, toneOf, type DueTone } from '@/features/maintenance/model';
import { formatNumber } from '@/lib/format';
import { radius, space, themes } from '@/theme/tokens.generated';

import { widgetLayout, type WidgetContent, type WidgetLayout, type WidgetRole } from './layout';
import { dueOn, type WidgetCar, type WidgetSnapshot } from './snapshot';

/** The brand photo of the empty state: porsche-992-01 at night cut to 4:5 at 480 × 600 (design/scripts/build-widget-assets.mjs). */
const EMPTY_PHOTO: number = require('../../../assets/widget/mein-auto-empty.jpg');

/** The scheme route of the wizard's first step (features/garage/navigation.ts wizardPath('new', 'vehicle')). */
export const ADD_VEHICLE_URI = 'speedclub://add-vehicle/new/vehicle';

export function carUri(vehicleId: string): string {
  return `speedclub://garage/${encodeURIComponent(vehicleId)}`;
}

export type WidgetMode = 'light' | 'dark';

type Palette = {
  surface: ColorProp;
  ground: ColorProp;
  primary: ColorProp;
  secondary: ColorProp;
  tone: Record<DueTone, ColorProp>;
};

function palette(name: 'carbon' | 'light'): Palette {
  const color = themes[name].color;
  return {
    surface: color.bg.surface,
    ground: color.media.ground,
    primary: color.text.primary,
    secondary: color.text.secondary,
    tone: { ok: color.text.primary, unknown: color.text.primary, soon: color.state.warning, overdue: color.accent.fg },
  };
}

/** Light follows Hell; dark follows Carbon, the app's default dark theme. */
const PALETTES: Record<WidgetMode, Palette> = { light: palette('light'), dark: palette('carbon') };

export type WidgetStrings = {
  t: TFunction<'garage'>;
  /** The Berlin day of the render (snapshot.ts dueOn). */
  today: string;
};

export type WidgetModel =
  | {
      kind: 'car';
      vehicleId: string;
      name: string;
      eyebrow: string | null;
      photo: { uri: string } | null;
      due: { label: string; countdown: string; tone: DueTone } | null;
      /** "60 Tage nichts fällig", when the list says so. */
      quiet: string | null;
      a11y: string;
    }
  | { kind: 'empty'; body: string; action: string; a11y: string };

/** What the widget says, in the snapshot's language, counted down to `today`. */
export function widgetModel(snapshot: WidgetSnapshot | null, { t, today }: WidgetStrings, windowDays: number): WidgetModel {
  const car: WidgetCar | null = snapshot?.car ?? null;
  if (!snapshot || !car) {
    return { kind: 'empty', body: t('widget.emptyBody'), action: t('widget.add'), a11y: t('widget.a11yEmpty') };
  }
  const locale = snapshot.locale;
  let due: Extract<WidgetModel, { kind: 'car' }>['due'] = null;
  if (car.due) {
    const now = dueOn(car.due, snapshot.day, today);
    const countdown = countdownText(t, now.days, now.km, snapshot.unit, locale);
    if (countdown) due = { label: now.title, countdown, tone: toneOf(now.state, now.days) };
  }
  const quiet = !due && car.dueKnown ? t('widget.nothingDue', { days: formatNumber(windowDays, locale) }) : null;
  const dueSentence = due ? `${t('widget.dueLine', { title: due.label, countdown: due.countdown })}.` : quiet ? `${quiet}.` : '';
  const fullName = car.eyebrow && !car.name.toLowerCase().startsWith(car.eyebrow.toLowerCase()) ? `${car.eyebrow} ${car.name}` : car.name;
  return {
    kind: 'car',
    vehicleId: car.id,
    name: car.name,
    eyebrow: car.eyebrow,
    photo: car.photo ? { uri: car.photo.uri } : null,
    due,
    quiet,
    a11y: t('widget.a11yCar', { name: fullName, due: dueSentence }).replace(/\s+/g, ' ').trim(),
  };
}

function text(layout: WidgetLayout, role: WidgetRole, color: ColorProp): TextWidgetStyle {
  const type = layout.type[role];
  return {
    fontFamily: type.fontFamily,
    fontWeight: type.fontWeight,
    fontSize: type.fontSize,
    lineHeight: type.lineHeight,
    letterSpacing: type.letterSpacing,
    color,
  };
}

function caps(value: string, locale: 'de' | 'en'): string {
  return value.toLocaleUpperCase(locale === 'en' ? 'en-GB' : 'de-DE');
}

type TreeProps = { model: WidgetModel; layout: WidgetLayout; mode: WidgetMode; locale: 'de' | 'en' };

function MeinAutoTree({ model, layout, mode, locale }: TreeProps) {
  const colors = PALETTES[mode];
  const root: FlexWidgetStyle = {
    width: 'match_parent',
    height: 'match_parent',
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
  };
  const pane: FlexWidgetStyle = { width: layout.paneWidth, height: 'match_parent', backgroundColor: colors.ground };
  const image = { width: layout.paneWidth, height: layout.height } as const;
  const panel: FlexWidgetStyle = {
    flex: 1,
    height: 'match_parent',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: layout.padding,
  };
  const group: FlexWidgetStyle = { flexDirection: 'column', flexGap: space[4] };

  const photo: ImageWidgetSource | null =
    model.kind === 'empty' ? EMPTY_PHOTO : model.photo ? (model.photo.uri as ImageWidgetSource) : null;
  const uri = model.kind === 'car' ? carUri(model.vehicleId) : ADD_VEHICLE_URI;

  return (
    <FlexWidget style={root} clickAction="OPEN_URI" clickActionData={{ uri }} accessibilityLabel={model.a11y}>
      {layout.paneWidth > 0 ? (
        <FlexWidget style={pane}>
          {photo !== null ? (
            <ImageWidget
              image={photo}
              imageWidth={layout.image.width}
              imageHeight={layout.image.height}
              resizeMode="cover"
              style={image}
            />
          ) : null}
        </FlexWidget>
      ) : null}
      {model.kind === 'car' ? (
        <FlexWidget style={panel}>
          <FlexWidget style={group}>
            {layout.eyebrow && model.eyebrow ? (
              <TextWidget
                text={caps(model.eyebrow, locale)}
                style={text(layout, 'labelCaps', colors.secondary)}
                allowFontScaling={false}
                maxLines={1}
                truncate="END"
              />
            ) : null}
            <TextWidget
              text={model.name}
              style={text(layout, 'displayWordmark', colors.primary)}
              allowFontScaling={false}
              maxLines={layout.nameLines}
              truncate="END"
            />
          </FlexWidget>
          {model.due && layout.due === 'two' ? (
            <FlexWidget style={group}>
              <TextWidget
                text={caps(model.due.label, locale)}
                style={text(layout, 'labelCaps', colors.secondary)}
                allowFontScaling={false}
                maxLines={1}
                truncate="END"
              />
              <TextWidget
                text={model.due.countdown}
                style={text(layout, 'callout', colors.tone[model.due.tone])}
                allowFontScaling={false}
                maxLines={layout.dueLines}
                truncate="END"
              />
            </FlexWidget>
          ) : model.due && layout.due === 'one' ? (
            <TextWidget
              text={`${model.due.label} ${model.due.countdown}`}
              style={text(layout, 'callout', colors.tone[model.due.tone])}
              allowFontScaling={false}
              maxLines={layout.dueLines}
              truncate="END"
            />
          ) : model.quiet && layout.due === 'quiet' ? (
            <TextWidget
              text={model.quiet}
              style={text(layout, 'callout', colors.secondary)}
              allowFontScaling={false}
              maxLines={layout.dueLines}
              truncate="END"
            />
          ) : null}
        </FlexWidget>
      ) : (
        <FlexWidget style={panel}>
          {layout.bodyLines > 0 ? (
            <TextWidget
              text={model.body}
              style={text(layout, 'callout', colors.secondary)}
              allowFontScaling={false}
              maxLines={layout.bodyLines}
              truncate="END"
            />
          ) : null}
          <TextWidget
            text={model.action}
            style={text(layout, 'calloutStrong', colors.primary)}
            allowFontScaling={false}
            maxLines={layout.actionLines}
            truncate="END"
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

/** The text the layout fits, in the case it is drawn in. */
export function contentOf(model: WidgetModel, locale: 'de' | 'en'): WidgetContent {
  if (model.kind === 'empty') return { kind: 'empty', body: model.body, action: model.action };
  return {
    kind: 'car',
    name: model.name,
    eyebrow: model.eyebrow ? caps(model.eyebrow, locale) : null,
    due: model.due ? { label: caps(model.due.label, locale), countdown: model.due.countdown } : null,
    quiet: model.quiet,
  };
}

export type WidgetSize = { width: number; height: number; fontScale: number };

/** Both trees for the launcher: it shows the one that matches the system's dark mode. */
export function meinAutoTrees(model: WidgetModel, size: WidgetSize, locale: 'de' | 'en') {
  const layout = widgetLayout(size.width, size.height, size.fontScale, contentOf(model, locale));
  return {
    light: <MeinAutoTree model={model} layout={layout} mode="light" locale={locale} />,
    dark: <MeinAutoTree model={model} layout={layout} mode="dark" locale={locale} />,
  };
}
