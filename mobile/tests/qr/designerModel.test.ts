import type { StickerDesign, StickerOptions } from '@/api/queries/stickers';
import { mockupFor, mockupLayout } from '@/features/qr/designer/mockups';
import { loupeLayout } from '@/features/qr/designer/PreviewStage';
import { svgOnStage } from '@/features/qr/components/StickerArt';
import {
  applyRules,
  customLineIssue,
  editorReducer,
  effectiveText,
  HISTORY_LIMIT,
  initialHistory,
  mayOrder,
  EXPANDED_MIN_DRAWN,
  expandedPreviewFit,
  mayRunScanTest,
  qaDesignerState,
  payloadOptions,
  sameState,
  scanGate,
  type DesignState,
} from '@/features/qr/designer/model';
import { deviceScanTest } from '@/features/qr/designer/scanTest';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));

const OPTIONS: StickerOptions = {
  size: 'm',
  colourway: 'white',
  material: 'transparent',
  qr: true,
  username: true,
  car_name: false,
  custom_line: null,
  mirrored: false,
};
const CLASSIC: DesignState = { template: 'classic', options: OPTIONS };
const withOptions = (patch: Partial<StickerOptions>, template: DesignState['template'] = 'classic'): DesignState => ({
  template,
  options: { ...OPTIONS, ...patch },
});

function design(patch: Partial<StickerDesign> = {}): StickerDesign {
  return {
    id: '01design',
    persisted: true as unknown as string,
    reference: 'SD7H2KQXMB',
    version: 3,
    revision: 2,
    template: 'classic',
    options: OPTIONS,
    effective: { username: true, car_name: false, custom_line: false },
    size_mm: { width: 156, height: 65 },
    qr_mm: 35.7,
    state: 'draft',
    scan_test: null,
    validated_at: null,
    order_requested_at: null,
    code: { display_code: '8TR0 Q3MC', active: true },
    warnings: [],
    urls: { preview_svg: null, share_png: null, print_svg: null, print_pdf: null, print_png: null },
    created_at: null,
    updated_at: null,
    ...patch,
  };
}

describe('STK-05 editor history (undo/redo, contract §3.1: local stack)', () => {
  it('undoes and redoes template switches and option toggles in order', () => {
    let history = initialHistory(CLASSIC);
    history = editorReducer(history, { type: 'edit', state: { ...CLASSIC, template: 'round' } });
    history = editorReducer(history, { type: 'edit', state: withOptions({ qr: false }, 'round') });
    expect(history.past).toHaveLength(2);

    history = editorReducer(history, { type: 'undo' });
    expect(history.present).toEqual({ ...CLASSIC, template: 'round' });
    history = editorReducer(history, { type: 'undo' });
    expect(history.present).toEqual(CLASSIC);
    expect(editorReducer(history, { type: 'undo' })).toBe(history);

    history = editorReducer(history, { type: 'redo' });
    history = editorReducer(history, { type: 'redo' });
    expect(history.present).toEqual(withOptions({ qr: false }, 'round'));
    expect(editorReducer(history, { type: 'redo' })).toBe(history);
  });

  it('turns a typed custom line into one undo step, and a new edit clears the redo stack', () => {
    let history = initialHistory(CLASSIC);
    for (const text of ['B', 'Bu', 'Built', 'Built not bought']) {
      history = editorReducer(history, { type: 'edit', state: withOptions({ custom_line: text }), coalesce: 'custom_line' });
    }
    expect(history.past).toHaveLength(1);
    history = editorReducer(history, { type: 'commit' });
    history = editorReducer(history, { type: 'edit', state: withOptions({ custom_line: 'Built not bought.' }), coalesce: 'custom_line' });
    expect(history.past).toHaveLength(2);

    history = editorReducer(history, { type: 'undo' });
    expect(history.future).toHaveLength(1);
    history = editorReducer(history, { type: 'edit', state: withOptions({ size: 'l', custom_line: 'Built not bought' }) });
    expect(history.future).toHaveLength(0);
  });

  it('keeps at most the history limit and starts over on a reset from the server', () => {
    let history = initialHistory(CLASSIC);
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) {
      history = editorReducer(history, { type: 'edit', state: withOptions({ size: index % 2 === 0 ? 'l' : 's' }) });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    history = editorReducer(history, { type: 'reset', state: CLASSIC });
    expect(history).toEqual(initialHistory(CLASSIC));
  });

  it('ignores an edit that changes nothing', () => {
    const history = initialHistory(CLASSIC);
    expect(editorReducer(history, { type: 'edit', state: withOptions({}) })).toBe(history);
  });
});

describe('STK-05 option rules (contract §1.1)', () => {
  const templates = undefined;

  it('moves white inks to transparent film', () => {
    const result = applyRules({ ...OPTIONS, colourway: 'white_red', material: 'white_vinyl' }, templates);
    expect(result.options.material).toBe('transparent');
    expect(result.changed).toContain('material');
  });

  it('keeps black ink on white vinyl, and turns mirrored off there', () => {
    const result = applyRules({ ...OPTIONS, colourway: 'black', material: 'white_vinyl', mirrored: true }, templates);
    expect(result.options.material).toBe('white_vinyl');
    expect(result.options.mirrored).toBe(false);
    expect(result.changed).toEqual(['mirrored']);
  });

  it('prints only the text options a template shows, and keeps the others', () => {
    const state = withOptions({ car_name: true, custom_line: 'Built not bought' }, 'round');
    expect(effectiveText(state)).toEqual({ username: true, car_name: false, custom_line: false });
    expect(effectiveText({ ...state, template: 'classic' })).toEqual({ username: true, car_name: true, custom_line: true });
  });

  it('checks the custom line as the server does: 24 visible characters, one line, the print font only', () => {
    expect(customLineIssue('Built not bought')).toBeNull();
    expect(customLineIssue('Ä'.repeat(24))).toBeNull();
    expect(customLineIssue('  Built not bought  ')).toBeNull();
    expect(customLineIssue('x'.repeat(25))).toBe('tooLong');
    expect(customLineIssue('Built\nnot bought')).toBe('lineBreak');
    expect(customLineIssue('低くて速い')).toBe('characters');
    expect(customLineIssue('Laut \u{1F525}')).toBe('characters');
    expect(customLineIssue('Ηλλάς Привет')).toBeNull();
  });

  it('sends the line trimmed and an empty line as null', () => {
    expect(payloadOptions({ ...OPTIONS, custom_line: '  Tief  ' }).custom_line).toBe('Tief');
    expect(payloadOptions({ ...OPTIONS, custom_line: '   ' }).custom_line).toBeNull();
    expect(sameState(withOptions({ custom_line: ' Tief' }), withOptions({ custom_line: 'Tief' }))).toBe(true);
  });
});

describe('STK-05 Scan-Test gate in front of "Bestellen"', () => {
  it('needs a saved version before the test, and the test before an order', () => {
    expect(scanGate({ design: design({ version: 0 }), unsaved: false })).toBe('needsSave');
    expect(scanGate({ design: design(), unsaved: true })).toBe('needsSave');
    const draft = scanGate({ design: design(), unsaved: false });
    expect(draft).toBe('needsTest');
    expect(mayRunScanTest(draft)).toBe(true);
    expect(mayOrder(draft)).toBe(false);
  });

  it('opens ordering after a passed test or for a design without QR, never after a failed one', () => {
    expect(mayOrder(scanGate({ design: design({ state: 'validated', scan_test: 'passed' }), unsaved: false }))).toBe(true);
    expect(
      mayOrder(scanGate({ design: design({ state: 'validated', scan_test: 'not_applicable', options: { ...OPTIONS, qr: false } }), unsaved: false })),
    ).toBe(true);
    const failed = scanGate({ design: design({ scan_test: 'failed' }), unsaved: false });
    expect(failed).toBe('failed');
    expect(mayOrder(failed)).toBe(false);
    expect(mayRunScanTest(failed)).toBe(true);
  });

  it('closes everything again on an edit after the test (the server opens the next draft)', () => {
    expect(scanGate({ design: design({ state: 'validated', scan_test: 'passed' }), unsaved: true })).toBe('needsSave');
  });

  it('blocks a QR design while staff took the code down', () => {
    expect(scanGate({ design: design({ warnings: ['no_active_code'] }), unsaved: false })).toBe('noActiveCode');
  });

  it('reports "unavailable" from the device step without a decoder, and never throws', async () => {
    await expect(deviceScanTest('<svg/>', '8TR0Q3MC')).resolves.toBe('unavailable');
    await expect(deviceScanTest(null, null)).resolves.toBe('unavailable');
    await expect(
      deviceScanTest('<svg/>', 'X', () => {
        throw new Error('decoder broke');
      }),
    ).resolves.toBe('unavailable');
    await expect(deviceScanTest('<svg/>', 'X', async () => 'passed')).resolves.toBe('passed');
  });
});

describe('"am Auto" layout', () => {
  it('draws a sticker at its real size against the photo and keeps it inside the frame', () => {
    const day = mockupFor('day');
    const small = mockupLayout(day, 320, { widthMm: 156, heightMm: 65 }, 8);
    const large = mockupLayout(day, 320, { widthMm: 192, heightMm: 80 }, 8);
    expect(large.sticker.width / small.sticker.width).toBeCloseTo(192 / 156, 3);
    const banner = mockupLayout(day, 320, { widthMm: 4800, heightMm: 800 }, 8);
    expect(banner.sticker.width).toBeLessThanOrEqual(320 - 16 + 0.001);
    expect(banner.sticker.left).toBeGreaterThanOrEqual(8);
    expect(small.photo.left).toBeLessThanOrEqual(0);
    expect(small.photo.left + small.photo.width).toBeGreaterThanOrEqual(320);
  });
});

describe('"am Auto" loupe (DQ-M54-05)', () => {
  it('centres the sticker in the loupe, enlarged at most 3× and never past its edges', () => {
    const frame = 320;
    const layout = mockupLayout(mockupFor('day'), frame, { widthMm: 156, heightMm: 65 }, 8);
    const loupe = loupeLayout(layout, frame);
    expect(loupe.sticker.width / layout.sticker.width).toBeLessThanOrEqual(3);
    expect(loupe.sticker.left + loupe.sticker.width / 2).toBeCloseTo(loupe.size / 2, 3);
    expect(loupe.sticker.width).toBeLessThanOrEqual(loupe.size - 16 + 0.001);
    const banner = loupeLayout(mockupLayout(mockupFor('day'), frame, { widthMm: 480, heightMm: 80 }, 8), frame);
    expect(banner.sticker.width).toBeLessThanOrEqual(banner.size - 16 + 0.001);
  });
});

describe('QA capture states (DQ-M54-07)', () => {
  it('opens another template, the QR code off or a custom line, and nothing for an unknown value', () => {
    expect(qaDesignerState(CLASSIC, 'vertical', 'x').template).toBe('vertical_jdm');
    expect(qaDesignerState(CLASSIC, 'qroff', 'x').options.qr).toBe(false);
    expect(qaDesignerState(CLASSIC, 'line', 'Built not bought').options.custom_line).toBe('Built not bought');
    expect(qaDesignerState(CLASSIC, 'expanded', 'x')).toBe(CLASSIC);
    expect(qaDesignerState(CLASSIC, undefined, 'x')).toBe(CLASSIC);
  });
});

describe('preview on its stage (design QA round 2)', () => {
  it('keeps the stage full width when the dock expands and shrinks only the drawing, as little as needed (DQ-M54R2-01)', () => {
    // 393 wide, 520 high stage, the dock covers 330 of it: a Classic (156 × 65) keeps 345 × 144 at full size and fits the 190 left.
    const fit = expandedPreviewFit({ stageWidth: 393, stageHeight: 520, cover: 330, ratio: 156 / 65, inset: 24 });
    expect(fit.scale).toBeCloseTo((190 - 48) / ((393 - 48) / (156 / 65)), 3);
    expect(fit.scale * (393 - 48)).toBeGreaterThan(300);
    expect(fit.shift).toBe(-165);
    expect(expandedPreviewFit({ stageWidth: 393, stageHeight: 520, cover: 0, ratio: 156 / 65, inset: 24 }).scale).toBe(1);
  });

  it('lays a portrait sticker down in the flat preview instead of shrinking it to a sliver (DQ-P5-205)', () => {
    // Vertical JDM (64 × 240) on a 393 × 491 stage, 300 covered: upright it fell to about 38 px wide.
    const portrait = { stageWidth: 393, stageHeight: 491, cover: 300, ratio: 64 / 240, inset: 24 };
    const drawnHeight = 491 - 48;
    const drawnWidth = drawnHeight * (64 / 240);
    const upright = (191 - 48) / drawnHeight;
    expect(drawnWidth * upright).toBeLessThan(EXPANDED_MIN_DRAWN);

    const flat = expandedPreviewFit({ ...portrait, rotatable: true });
    expect(flat.rotate).toBe(true);
    // Lying down, the long side fits the stage width and the whole sticker stays in the part the dock leaves.
    expect(flat.scale * drawnHeight).toBeLessThanOrEqual(393 - 48 + 1e-6);
    expect(flat.scale * drawnWidth).toBeLessThanOrEqual(191 - 48 + 1e-6);
    expect(flat.scale * drawnHeight).toBeGreaterThan(300);

    // A car photo or the ruler does not turn: it keeps the minimum width (here its full size, 118 wide, never enlarged past it)
    // and the dock crops it.
    const car = expandedPreviewFit(portrait);
    expect(car.rotate).toBe(false);
    expect(car.scale).toBe(1);
    expect(car.shift).toBe(-150);
    const wide = expandedPreviewFit({ ...portrait, stageWidth: 1024, stageHeight: 900, cover: 700 });
    expect(wide.rotate).toBe(false);
    expect(wide.scale * (900 - 48) * (64 / 240)).toBeCloseTo(EXPANDED_MIN_DRAWN, 6);
  });

  it('keeps a landscape or wide-enough portrait sticker upright', () => {
    expect(expandedPreviewFit({ stageWidth: 393, stageHeight: 520, cover: 330, ratio: 156 / 65, inset: 24, rotatable: true }).rotate).toBe(false);
    expect(expandedPreviewFit({ stageWidth: 393, stageHeight: 520, cover: 0, ratio: 64 / 240, inset: 24, rotatable: true })).toEqual({ scale: 1, shift: -0, rotate: false });
  });

  it('draws a Round sticker without the square surface tile (DQ-M54R2-02)', () => {
    const svg = '<svg><rect id="surface" width="78" height="78" fill="#0B0B0C"/><path id="material" d="M0 39z" fill="#0B0B0C"/></svg>';
    expect(svgOnStage(svg)).toBe('<svg><path id="material" d="M0 39z" fill="#0B0B0C"/></svg>');
  });
});
