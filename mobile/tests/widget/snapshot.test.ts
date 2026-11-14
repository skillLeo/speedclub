import i18n from '@/i18n';
import { coverSize, focalCrop, PHOTO_ASPECT, textStyle, widgetLayout, type WidgetContent } from '@/features/widget/layout';
import { estimatedWidth, wrappedLines } from '@/features/widget/metrics';
import {
  buildSnapshot,
  daysBetween,
  dueOn,
  parseSnapshot,
  pickDue,
  pickMainVehicle,
  snapshotSchema,
} from '@/features/widget/snapshot';
import { fonts, typography } from '@/theme/tokens.generated';

import { R34, S15, snapshot, upcoming, vehicle } from './fixtures';

const t = i18n.getFixedT('de', 'garage');

describe('widget snapshot (the JSON the widget reads)', () => {
  it('picks the main car, else the first one, and never a draft', () => {
    const main = vehicle({ id: S15, is_main: true });
    expect(pickMainVehicle([vehicle({ is_main: false }), main])?.id).toBe(S15);
    expect(pickMainVehicle([vehicle({ id: 'draft', status: 'draft', is_main: true }), vehicle({ is_main: false })])?.id).toBe(R34);
    expect(pickMainVehicle([vehicle({ status: 'draft' })])).toBeNull();
    expect(pickMainVehicle([])).toBeNull();
  });

  it("takes the car's own next item, overdue first", () => {
    const list = [
      upcoming({ id: 'other', vehicle_id: S15, days_left: -3, state: 'overdue' }),
      upcoming({ id: 'service', type: 'service', days_left: 20, state: 'soon' }),
      upcoming({ id: 'hu', type: 'hu_au', days_left: -5, state: 'overdue' }),
    ];
    expect(pickDue(t, list, R34, 6)).toEqual({ due: { title: 'HU/AU', days: -5, km: null, state: 'overdue' }, known: true });
  });

  it('keeps a mileage-only item, and skips disabled ones', () => {
    const list = [
      upcoming({ id: 'off', enabled: false, days_left: 1 }),
      upcoming({ id: 'oil', type: 'oil_change', days_left: null, km_left: 1200, next_due: { date: null, month: null, km: 45000, pinned: false, deadline: null } }),
    ];
    expect(pickDue(t, list, R34, 6).due).toEqual({ title: 'Ölwechsel', days: null, km: 1200, state: 'ok' });
  });

  it('claims "nothing due" only when the list was read and not cut off', () => {
    expect(pickDue(t, undefined, R34, 6)).toEqual({ due: null, known: false });
    expect(pickDue(t, [], R34, 6)).toEqual({ due: null, known: true });
    const full = Array.from({ length: 6 }, (_, index) => upcoming({ id: `s${index}`, vehicle_id: S15 }));
    expect(pickDue(t, full, R34, 6)).toEqual({ due: null, known: false });
  });

  it('builds a snapshot without a token, an address or a remote URL to load', () => {
    const built = buildSnapshot({
      member: 'member-1',
      locale: 'de',
      unit: 'km',
      now: new Date('2026-11-13T23:30:00Z'),
      car: vehicle(),
      photo: snapshot().car?.photo ?? null,
      due: { due: { title: 'HU/AU', days: 43, km: null, state: 'ok' }, known: true },
    });
    // 23:30 UTC is already the 14th in Berlin, where the server counts.
    expect(built.day).toBe('2026-11-14');
    expect(built.car).toMatchObject({ id: R34, name: 'Skyline GT-R R34', eyebrow: 'NISSAN', dueKnown: true });
    expect(snapshotSchema.safeParse(built).success).toBe(true);
    const text = JSON.stringify(built);
    expect(text).not.toMatch(/token|Bearer|@|https?:\/\/(?!cdn)/i);
    expect(Object.keys(built).sort()).toEqual(['car', 'day', 'locale', 'member', 'unit', 'v']);
  });

  it('builds the empty snapshot without a car', () => {
    const built = buildSnapshot({ member: 'm', locale: 'en', unit: 'mi', now: new Date('2026-11-13T10:00:00Z'), car: null, photo: null, due: { due: null, known: false } });
    expect(built.car).toBeNull();
  });

  it('reads a valid snapshot and refuses torn, old or foreign files', () => {
    expect(parseSnapshot(JSON.stringify(snapshot()))).toEqual(snapshot());
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('{"v":1,')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...snapshot(), v: 0 }))).toBeNull();
    const remotePhoto = snapshot();
    if (remotePhoto.car?.photo) remotePhoto.car.photo.uri = 'https://cdn/1080.webp';
    expect(parseSnapshot(JSON.stringify(remotePhoto))).toBeNull();
  });

  it('counts the stored countdown down by the Berlin days since it was written', () => {
    expect(daysBetween('2026-11-13', '2026-11-16')).toBe(3);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    const due = { title: 'HU/AU', days: 2, km: null, state: 'soon' as const };
    expect(dueOn(due, '2026-11-13', '2026-11-14')).toMatchObject({ days: 1, state: 'soon' });
    expect(dueOn(due, '2026-11-13', '2026-11-16')).toMatchObject({ days: -1, state: 'overdue' });
    // A clock set back never counts up.
    expect(dueOn(due, '2026-11-13', '2026-11-10').days).toBe(2);
    const km = { title: 'Ölwechsel', days: null, km: 800, state: 'ok' as const };
    expect(dueOn(km, '2026-11-13', '2026-12-13')).toEqual(km);
  });
});

describe('widget layout', () => {
  it('draws each face at its own weight, scaled with the system up to the caps', () => {
    expect(textStyle('displayWordmark', 1)).toEqual({
      fontFamily: typography.displayWordmark.fontFamily,
      fontWeight: '600',
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: typography.displayWordmark.letterSpacing,
    });
    expect(textStyle('callout', 1).fontWeight).toBe('500');
    expect(fonts.marque.native['600']).toBe(typography.displayWordmark.fontFamily);
    // The name caps at 1.3 (display roles), Inter roles at 2.
    expect(textStyle('displayWordmark', 2).fontSize).toBe(Math.round(17 * 1.3));
    expect(textStyle('callout', 3).fontSize).toBe(28);
    expect(textStyle('callout', 0.85).fontSize).toBe(14);
  });

  const R34_DUE: WidgetContent = { kind: 'car', name: 'Skyline GT-R R34', eyebrow: 'NISSAN', due: { label: 'HU/AU', countdown: 'in 43 Tagen' }, quiet: null };
  const R34_QUIET: WidgetContent = { ...R34_DUE, due: null, quiet: '60 Tage nichts fällig' } as WidgetContent;
  const EMPTY: WidgetContent = { kind: 'empty', body: 'Dein Auto und seine nächste Fälligkeit.', action: 'Auto hinzufügen' };
  // A 4 × 2 widget on a 360 dp phone (el36): about 260 × 153 dp, so the text column beside the photo is about 120 dp.
  const PHONE_4X2 = [260, 153] as const;

  it('shows everything at the default 4 × 2 size, the name on as many lines as it needs', () => {
    const layout = widgetLayout(352, 176, 1, R34_DUE);
    expect(layout).toMatchObject({ eyebrow: true, nameLines: 1, due: 'two', dueLines: 1, paneWidth: 148 });
    expect(layout.image.width / layout.image.height).toBeCloseTo(PHOTO_ASPECT, 2);
    expect(layout.image.width).toBeGreaterThanOrEqual(layout.paneWidth);
    expect(layout.image.height).toBeGreaterThanOrEqual(176);
    expect(widgetLayout(...PHONE_4X2, 1, R34_DUE)).toMatchObject({ eyebrow: true, nameLines: 2, due: 'two', paneWidth: 109 });
  });

  it('fits the "nothing due" line in full at 4 × 2 (M4.19: it was cut after two lines)', () => {
    expect(widgetLayout(...PHONE_4X2, 1, R34_QUIET)).toMatchObject({ eyebrow: true, nameLines: 2, due: 'quiet', dueLines: 2, paneWidth: 109 });
    // The old copy needed three lines in the 119 dp column; the layout would now narrow the photo for it instead of cutting it.
    const old = { ...R34_QUIET, quiet: 'In den nächsten 60 Tagen nichts fällig' } as WidgetContent;
    expect(wrappedLines('In den nächsten 60 Tagen nichts fällig', 119, (part) => estimatedWidth(part, 'medium', 14, 0))).toBe(3);
    expect(widgetLayout(...PHONE_4X2, 1, old).paneWidth).toBeLessThan(109);
  });

  it('gives the photo up before it cuts the name or the due line at 200 % (M4.19: "Skyline …", "In den nächst…")', () => {
    const due = widgetLayout(...PHONE_4X2, 2, R34_DUE);
    expect(due).toMatchObject({ paneWidth: 0, eyebrow: false, nameLines: 1, due: 'two', dueLines: 1 });
    const quiet = widgetLayout(...PHONE_4X2, 2, R34_QUIET);
    expect(quiet).toMatchObject({ paneWidth: 0, nameLines: 1, due: 'quiet', dueLines: 2 });
    // Both fit the panel's height.
    for (const layout of [due, quiet]) {
      const { labelCaps, callout, displayWordmark } = layout.type;
      const dueHeight = layout.due === 'two' ? labelCaps.lineHeight + 4 + callout.lineHeight * layout.dueLines : callout.lineHeight * layout.dueLines;
      expect(displayWordmark.lineHeight * layout.nameLines + 8 + dueHeight).toBeLessThanOrEqual(153 - 2 * layout.padding);
    }
  });

  it('drops the make, then joins the due line, then narrows the photo; the due line goes last', () => {
    expect(widgetLayout(250, 130, 1, R34_DUE)).toMatchObject({ eyebrow: false, nameLines: 2, due: 'two' });
    expect(widgetLayout(250, 110, 1, R34_DUE)).toMatchObject({ eyebrow: false, nameLines: 2, due: 'one', dueLines: 1, paneWidth: 65 });
    expect(widgetLayout(352, 176, 2, R34_DUE)).toMatchObject({ eyebrow: false, nameLines: 2, due: 'two', paneWidth: 148 });
    // 250 × 110 at 200 %: no due line fits even across the whole width, so the name stays alone and the photo comes back.
    expect(widgetLayout(250, 110, 2, R34_DUE)).toMatchObject({ due: 'none', nameLines: 2, paneWidth: 85 });
    expect(widgetLayout(250, 80, 2, R34_DUE)).toMatchObject({ due: 'none', nameLines: 1, paneWidth: 0 });
  });

  it('never trades the photo for a name that is too long for two lines anyway', () => {
    const long = {
      ...R34_DUE,
      name: 'Mercedes-AMG GT Black Series Project One Edition Carbon Nürburgring Clubsport Heritage Collection Number Seven',
    } as WidgetContent;
    expect(widgetLayout(352, 176, 1, long)).toMatchObject({ nameLines: 2, paneWidth: 148 });
    // A name that fits two lines across the whole width keeps its full length; the photo gives way for it.
    const fits = { ...R34_DUE, name: 'Mercedes-AMG GT Black Series Project One Edition' } as WidgetContent;
    expect(widgetLayout(352, 176, 1, fits).nameLines).toBe(2);
  });

  it('shows the invitation only in full, and the action on up to two lines', () => {
    expect(widgetLayout(...PHONE_4X2, 1, EMPTY)).toMatchObject({ bodyLines: 3, actionLines: 1, paneWidth: 109 });
    expect(widgetLayout(352, 176, 1, EMPTY)).toMatchObject({ bodyLines: 2, actionLines: 1 });
    const large = widgetLayout(...PHONE_4X2, 2, EMPTY);
    expect(large).toMatchObject({ bodyLines: 0, actionLines: 2 });
    expect(widgetLayout(250, 110, 2, EMPTY)).toMatchObject({ bodyLines: 0, actionLines: 1, paneWidth: 0 });
  });

  it('wraps at spaces like Android and treats a word wider than the line as no fit', () => {
    const measure = (part: string) => part.length * 10;
    expect(wrappedLines('aa bb cc', 50, measure)).toBe(2);
    expect(wrappedLines('aa bb cc', 80, measure)).toBe(1);
    expect(wrappedLines('aaaaaaa', 50, measure)).toBe(Number.POSITIVE_INFINITY);
    expect(wrappedLines('', 50, measure)).toBe(0);
  });

  it('covers any pane at 4:5 without stretching', () => {
    expect(coverSize(148, 176)).toEqual({ width: 148, height: 185 });
    expect(coverSize(100, 300)).toEqual({ width: 240, height: 300 });
    expect(coverSize(0, 300)).toEqual({ width: 1, height: 1 });
  });

  it('cuts the 4:5 crop around the focal point and inside the photo', () => {
    expect(focalCrop(1440, 1920, { x: 0.54, y: 0.66 })).toEqual({ originX: 0, originY: 120, width: 1440, height: 1800 });
    expect(focalCrop(1920, 1080, { x: 0.9, y: 0.5 })).toEqual({ originX: 1056, originY: 0, width: 864, height: 1080 });
    expect(focalCrop(1920, 1080, null)).toEqual({ originX: 528, originY: 0, width: 864, height: 1080 });
    expect(focalCrop(1920, 1080, { x: -1, y: 2 }).originX).toBe(0);
  });
});
