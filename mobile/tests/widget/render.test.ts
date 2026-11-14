import type { WidgetInfo, WidgetTaskHandlerProps, WidgetRepresentation } from 'react-native-android-widget';

import { ADD_VEHICLE_URI, carUri } from '@/features/widget/MeinAutoWidget';
import { meinAutoTaskHandler, renderMeinAuto } from '@/features/widget/render';
import type { WidgetSnapshot } from '@/features/widget/snapshot';
import { themes } from '@/theme/tokens.generated';

import { R34, snapshot } from './fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn(() => new Promise(() => undefined)) }));

type Tree = { type: string; props: Record<string, unknown>; children?: Tree[] };

// The library's own tree builder, which the native side receives: it validates every element and converts its props.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildWidgetTree } = require('react-native-android-widget/lib/commonjs/api/build-widget-tree') as {
  buildWidgetTree: (element: React.JSX.Element) => Tree;
};

const INFO: WidgetInfo = {
  widgetName: 'MeinAuto',
  widgetId: 7,
  width: 352,
  height: 176,
  screenInfo: { screenHeightDp: 915, screenWidthDp: 412, density: 2.625, densityDpi: 420, fontScale: 1 },
};
const NOW = new Date('2026-11-13T10:00:00Z');
const exists = () => true;

function trees(representation: WidgetRepresentation): { light: Tree; dark: Tree } {
  if (!('light' in representation) || !representation.dark) throw new Error('expected a light and a dark tree');
  return { light: buildWidgetTree(representation.light), dark: buildWidgetTree(representation.dark) };
}

function flatten(tree: Tree): Tree[] {
  return [tree, ...(tree.children ?? []).flatMap(flatten)];
}

const texts = (tree: Tree) => flatten(tree).filter((node) => node.type === 'TextWidget').map((node) => node.props.text);
const images = (tree: Tree) => flatten(tree).filter((node) => node.type === 'ImageWidget');

describe('widget "Mein Auto" trees', () => {
  it('shows the car: photo file, make, name in Archivo SemiExpanded, next due item', () => {
    const { light, dark } = trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, snapshot(), NOW, exists));
    expect(texts(dark)).toEqual(['NISSAN', 'Skyline GT-R R34', 'HU/AU', 'in 43 Tagen']);
    const name = flatten(dark).find((node) => node.props.text === 'Skyline GT-R R34');
    expect(name?.props).toMatchObject({ fontFamily: 'ArchivoSemiExpanded-SemiBold', fontWeight: '600', allowFontScaling: false, maxLines: 1 });
    const [photo] = images(dark);
    expect(photo?.props).toMatchObject({ image: { uri: 'file:///docs/widget/car-m1-1080.jpg' }, resizeMode: 'cover' });
    expect(dark.props).toMatchObject({ clickAction: 'OPEN_URI', clickActionData: { uri: `speedclub://garage/${R34}` } });
    expect(dark.props.accessibilityLabel).toBe('Mein Auto: NISSAN Skyline GT-R R34. HU/AU in 43 Tagen. Öffnet dein Auto in der Garage.');
    // Same content, the theme's own surface and text.
    expect(texts(light)).toEqual(texts(dark));
    expect(dark.props.backgroundColor).toBe(themes.carbon.color.bg.surface);
    expect(light.props.backgroundColor).toBe(themes.light.color.bg.surface);
    expect(name?.props.color).toBe(themes.carbon.color.text.primary);
    expect(flatten(light).find((node) => node.props.text === 'Skyline GT-R R34')?.props.color).toBe(themes.light.color.text.primary);
  });

  it('counts down from the stored day and turns overdue in the accent', () => {
    const later = new Date('2026-12-30T10:00:00Z');
    const { dark, light } = trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, snapshot(), later, exists));
    const countdown = flatten(dark).find((node) => node.props.text === 'seit 4 Tagen überfällig');
    expect(countdown?.props.color).toBe(themes.carbon.color.accent.fg);
    expect(flatten(light).find((node) => node.props.text === 'seit 4 Tagen überfällig')?.props.color).toBe(themes.light.color.accent.fg);
    const soon = trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, snapshot(), new Date('2026-12-10T10:00:00Z'), exists));
    expect(flatten(soon.dark).find((node) => node.props.text === 'in 16 Tagen')?.props.color).toBe(themes.carbon.color.state.warning);
  });

  it('says "nichts fällig" only when the list says so', () => {
    const quiet = snapshot();
    if (quiet.car) quiet.car = { ...quiet.car, due: null, dueKnown: true };
    expect(texts(trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, quiet, NOW, exists)).dark)).toContain(
      '60 Tage nichts fällig',
    );
    if (quiet.car) quiet.car = { ...quiet.car, dueKnown: false };
    expect(texts(trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, quiet, NOW, exists)).dark)).toEqual(['NISSAN', 'Skyline GT-R R34']);
  });

  it('speaks English when the snapshot was written in English', () => {
    const { dark } = trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, snapshot({ locale: 'en' }), NOW, exists));
    expect(texts(dark)).toEqual(['NISSAN', 'Skyline GT-R R34', 'HU/AU', 'in 43 days']);
  });

  it('fits the minimum size without cutting: the photo narrows, the due item joins one line', () => {
    const { dark } = trees(renderMeinAuto({ width: 250, height: 110, fontScale: 1 }, snapshot(), NOW, exists));
    expect(texts(dark)).toEqual(['Skyline GT-R R34', 'HU/AU in 43 Tagen']);
    expect(flatten(dark).find((node) => node.props.text === 'Skyline GT-R R34')?.props.maxLines).toBe(2);
    expect(dark.children?.[0]?.props.width).toBe(65);
    // 200 %: no due line fits even across the whole width, so it is left out instead of cut.
    const large = trees(renderMeinAuto({ width: 250, height: 110, fontScale: 2 }, snapshot(), NOW, exists));
    expect(texts(large.dark)).toEqual(['Skyline GT-R R34']);
  });

  it('at 4 × 2 on a 360 dp phone: the "nothing due" line in full, and at 200 % the text across the whole widget (M4.19)', () => {
    const quiet = snapshot();
    if (quiet.car) quiet.car = { ...quiet.car, due: null, dueKnown: true };
    const normal = trees(renderMeinAuto({ width: 260, height: 153, fontScale: 1 }, quiet, NOW, exists));
    expect(texts(normal.dark)).toEqual(['NISSAN', 'Skyline GT-R R34', '60 Tage nichts fällig']);
    expect(flatten(normal.dark).find((node) => node.props.text === '60 Tage nichts fällig')?.props.maxLines).toBe(2);
    expect(images(normal.dark)).toHaveLength(1);

    const large = trees(renderMeinAuto({ width: 260, height: 153, fontScale: 2 }, snapshot(), NOW, exists));
    expect(texts(large.dark)).toEqual(['Skyline GT-R R34', 'HU/AU', 'in 43 Tagen']);
    expect(images(large.dark)).toHaveLength(0);
    expect(flatten(large.dark).find((node) => node.props.text === 'in 43 Tagen')?.props).toMatchObject({ fontSize: 28, maxLines: 1 });
    expect(flatten(large.dark).find((node) => node.props.text === 'Skyline GT-R R34')?.props.maxLines).toBe(1);
    // The tap target and the spoken label do not depend on the layout.
    expect(large.dark.props).toMatchObject({ clickAction: 'OPEN_URI', clickActionData: { uri: `speedclub://garage/${R34}` } });
  });

  it('keeps a dark pane when the photo file is gone, and never loads a URL', () => {
    const { dark } = trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, snapshot(), NOW, () => false));
    expect(images(dark)).toHaveLength(0);
    const pane = dark.children?.[0];
    expect(pane?.props.backgroundColor).toBe(themes.carbon.color.media.ground);
  });

  it('shows the brand photo and "Auto hinzufügen" without a car, signed out or cleared', () => {
    for (const empty of [null, snapshot({ car: null })] as (WidgetSnapshot | null)[]) {
      const { dark, light } = trees(renderMeinAuto({ width: 352, height: 176, fontScale: 1 }, empty, NOW, exists));
      expect(texts(dark)).toEqual(['Dein Auto und seine nächste Fälligkeit.', 'Auto hinzufügen']);
      expect(images(dark)).toHaveLength(1);
      expect(dark.props).toMatchObject({ clickAction: 'OPEN_URI', clickActionData: { uri: ADD_VEHICLE_URI } });
      expect(dark.props.accessibilityLabel).toBe('Mein Auto: noch kein Auto. Auto hinzufügen.');
      expect(light.props.backgroundColor).toBe(themes.light.color.bg.surface);
    }
  });

  it('encodes the vehicle id in the tap target', () => {
    expect(carUri('a/b')).toBe('speedclub://garage/a%2Fb');
  });
});

describe('widget task handler', () => {
  const props = (widgetAction: WidgetTaskHandlerProps['widgetAction'], info: Partial<WidgetInfo> = {}) => {
    const renderWidget = jest.fn<void, [WidgetRepresentation]>();
    return { props: { widgetInfo: { ...INFO, ...info }, widgetAction, renderWidget } as WidgetTaskHandlerProps, renderWidget };
  };

  it.each(['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'] as const)('draws from the stored snapshot on %s', async (action) => {
    const { props: handlerProps, renderWidget } = props(action);
    const read = jest.fn(() => Promise.resolve(snapshot()));
    await meinAutoTaskHandler(handlerProps, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(renderWidget).toHaveBeenCalledTimes(1);
    const drawn = renderWidget.mock.calls[0]?.[0];
    if (!drawn) throw new Error('nothing drawn');
    // The handler's trees are valid for the native side.
    expect(texts(trees(drawn).dark)).toContain('Skyline GT-R R34');
  });

  it('draws the empty state when nothing is stored', async () => {
    const { props: handlerProps, renderWidget } = props('WIDGET_UPDATE');
    await meinAutoTaskHandler(handlerProps, () => Promise.resolve(null));
    const drawn = renderWidget.mock.calls[0]?.[0];
    if (!drawn) throw new Error('nothing drawn');
    expect(texts(trees(drawn).dark)).toContain('Auto hinzufügen');
  });

  it('does nothing for a removed widget, a tap or another widget', async () => {
    for (const [action, info] of [['WIDGET_DELETED', {}], ['WIDGET_CLICK', {}], ['WIDGET_UPDATE', { widgetName: 'Other' }]] as const) {
      const { props: handlerProps, renderWidget } = props(action, info);
      const read = jest.fn(() => Promise.resolve(snapshot()));
      await meinAutoTaskHandler(handlerProps, read);
      expect(renderWidget).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    }
  });
});
