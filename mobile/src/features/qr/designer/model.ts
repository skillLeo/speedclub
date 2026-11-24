/**
 * STK-05 Sticker designer (10 §2.3, m5.4-contract §1.1/§2): the editor's state, its rules, the local undo/redo stack and the gate
 * in front of "Bestellen". Pure: no React, no network, so the state machine is tested on its own (tests/qr/designerModel.test.ts).
 *
 * The server stays the judge (it normalises and validates every save); these rules only keep the editor from offering a state the
 * server would refuse: white inks print on transparent film only, a mirrored print needs transparent film, the custom line is one
 * line of at most 24 characters the print font has.
 */
import { z } from 'zod';

import type {
  StickerColourway,
  StickerDesign,
  StickerOptions,
  StickerTemplateKey,
  StickerTemplates,
} from '@/api/queries/stickers';
import { stableOptions } from '@/api/queries/stickers';

export type StickerColourwayKey = StickerOptions['colourway'];
export type StickerMaterialKey = StickerOptions['material'];
export type StickerSizeKey = StickerOptions['size'];
export type TextOption = 'username' | 'car_name' | 'custom_line';

export type DesignState = { template: StickerTemplateKey; options: StickerOptions };

/** The order of the template rail (10 §2.3). */
export const TEMPLATE_ORDER: readonly StickerTemplateKey[] = ['classic', 'minimal', 'banner', 'plate', 'vertical_jdm', 'round'];
export const COLOURWAY_ORDER: readonly StickerColourwayKey[] = ['white', 'black', 'white_red'];
export const SIZE_ORDER: readonly StickerSizeKey[] = ['s', 'm', 'l'];
export const MATERIAL_ORDER: readonly StickerMaterialKey[] = ['transparent', 'white_vinyl'];

/** Contract §1.1 / limits.custom_line_max. */
export const CUSTOM_LINE_MAX = 24;

/** Contract §1.1: what each colourway may print on when the template list has not loaded yet. */
const FALLBACK_MATERIALS: Readonly<Record<StickerColourwayKey, readonly StickerMaterialKey[]>> = {
  white: ['transparent'],
  black: ['transparent', 'white_vinyl'],
  white_red: ['transparent'],
};

/** Contract §2: the text options each template prints, when the template list has not loaded yet. */
const FALLBACK_TEXT_OPTIONS: Readonly<Record<StickerTemplateKey, readonly TextOption[]>> = {
  classic: ['username', 'car_name', 'custom_line'],
  minimal: ['username'],
  banner: ['username', 'car_name', 'custom_line'],
  plate: ['username', 'custom_line'],
  vertical_jdm: ['username', 'car_name'],
  round: ['username'],
};

export function materialsFor(colourway: StickerColourwayKey, templates?: StickerTemplates | null): readonly StickerMaterialKey[] {
  return templates?.colourways.find((entry) => entry.key === colourway)?.materials ?? FALLBACK_MATERIALS[colourway];
}

export function textOptionsFor(template: StickerTemplateKey, templates?: StickerTemplates | null): readonly TextOption[] {
  return templates?.templates.find((entry) => entry.key === template)?.options ?? FALLBACK_TEXT_OPTIONS[template];
}

/** What this template prints of the member's text choices (the server's `effective`, computed for the unsaved state). */
export function effectiveText(state: DesignState, templates?: StickerTemplates | null): Record<TextOption, boolean> {
  const shown = textOptionsFor(state.template, templates);
  return {
    username: shown.includes('username') && state.options.username,
    car_name: shown.includes('car_name') && state.options.car_name,
    custom_line: shown.includes('custom_line') && (state.options.custom_line ?? '').trim() !== '',
  };
}

/**
 * The rules after a change, in the order a member reads them: a colourway that cannot print on the chosen film moves to the first
 * film it can; a mirrored print stays mirrored only on transparent film. `changed` names what the editor changed on its own, so
 * the screen can say so ("Spiegeldruck geht nur auf transparenter Folie").
 */
export function applyRules(
  options: StickerOptions,
  templates?: StickerTemplates | null,
): { options: StickerOptions; changed: readonly ('material' | 'mirrored')[] } {
  const changed: ('material' | 'mirrored')[] = [];
  let next = options;
  const allowed = materialsFor(next.colourway, templates);
  if (!allowed.includes(next.material)) {
    next = { ...next, material: allowed[0] ?? 'transparent' };
    changed.push('material');
  }
  if (next.mirrored && next.material !== 'transparent') {
    next = { ...next, mirrored: false };
    changed.push('mirrored');
  }
  return { options: next, changed };
}

// -- Custom line (Zod: the same rules the server applies before its keyword screening)

/** Letters outside the print font (Inter: Latin, Greek, Cyrillic), emoji and control characters. */
const OUTSIDE_FONT = /(?![\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{L}|\p{Extended_Pictographic}|\p{Cc}|\p{Cf}/u;

/** Visible characters, as the server counts them (graphemes). */
export function graphemeCount(text: string): number {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter('de', { granularity: 'grapheme' }).segment(text)).length;
  return Array.from(text).length;
}

export type CustomLineIssue = 'tooLong' | 'lineBreak' | 'characters';

export const customLineSchema = z
  .string()
  .superRefine((value, context) => {
    if (/[\r\n]/.test(value)) context.addIssue({ code: 'custom', message: 'lineBreak' });
    else if (OUTSIDE_FONT.test(value)) context.addIssue({ code: 'custom', message: 'characters' });
    else if (graphemeCount(value.trim()) > CUSTOM_LINE_MAX) context.addIssue({ code: 'custom', message: 'tooLong' });
  });

export function customLineIssue(value: string | null | undefined): CustomLineIssue | null {
  const result = customLineSchema.safeParse(value ?? '');
  if (result.success) return null;
  const message = result.error.issues[0]?.message;
  return message === 'tooLong' || message === 'lineBreak' || message === 'characters' ? message : 'characters';
}

/** What a save sends: the line trimmed, an empty line as null (contract §1.1). */
export function payloadOptions(options: StickerOptions): StickerOptions {
  const line = (options.custom_line ?? '').trim();
  return { ...options, custom_line: line === '' ? null : line };
}

export function stateKey(state: DesignState): string {
  return `${state.template}|${stableOptions(payloadOptions(state.options))}`;
}

export function sameState(a: DesignState, b: DesignState): boolean {
  return stateKey(a) === stateKey(b);
}

export function stateOf(design: Pick<StickerDesign, 'template' | 'options'>): DesignState {
  return { template: design.template, options: { ...design.options } };
}

// -- Undo/redo (local, contract §3.1: an undo that reaches the server is just another autosave)

export const HISTORY_LIMIT = 50;

export type EditorHistory = {
  past: readonly DesignState[];
  present: DesignState;
  future: readonly DesignState[];
  /** Consecutive edits of one text field form one undo step (typing "Built not bought" is one step, not sixteen). */
  coalesce: string | null;
};

export type EditorAction =
  | { type: 'edit'; state: DesignState; coalesce?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  /** The server's state replaces everything (first load, a conflict reload, a restore): no undo across it. */
  | { type: 'reset'; state: DesignState }
  /** Ends a typing run, so the next keystroke starts a new undo step. */
  | { type: 'commit' };

export function initialHistory(state: DesignState): EditorHistory {
  return { past: [], present: state, future: [], coalesce: null };
}

export function editorReducer(history: EditorHistory, action: EditorAction): EditorHistory {
  switch (action.type) {
    case 'edit': {
      if (sameState(action.state, history.present) && action.state.options.custom_line === history.present.options.custom_line) {
        return history;
      }
      const coalesce = action.coalesce ?? null;
      if (coalesce !== null && coalesce === history.coalesce) {
        return { ...history, present: action.state, future: [] };
      }
      const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
      return { past, present: action.state, future: [], coalesce };
    }
    case 'undo': {
      const previous = history.past.at(-1);
      if (!previous) return history;
      return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], coalesce: null };
    }
    case 'redo': {
      const [next, ...rest] = history.future;
      if (!next) return history;
      return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: rest, coalesce: null };
    }
    case 'reset':
      return initialHistory(action.state);
    case 'commit':
      return history.coalesce === null ? history : { ...history, coalesce: null };
  }
}

// -- Scan-Test gate (10 §2.3: "every design is decoded … before it can be saved or ordered")

export type ScanGate =
  /** Changes are not on the server yet: the autosave runs first. */
  | 'needsSave'
  /** Saved, not tested yet (or edited after a test: the server opened a new draft). */
  | 'needsTest'
  | 'passed'
  /** QR off: nothing to scan, validated without a test; the warning stays. */
  | 'notApplicable'
  | 'failed'
  /** QR on, but staff took the car's code down: no test, no order. */
  | 'noActiveCode';

export function scanGate(input: {
  design: Pick<StickerDesign, 'version' | 'state' | 'scan_test' | 'warnings' | 'options' | 'template'> | null | undefined;
  /** The editor's state differs from the design's, or a save is under way. */
  unsaved: boolean;
}): ScanGate {
  const { design, unsaved } = input;
  if (!design || unsaved || design.version === 0) return 'needsSave';
  if (design.options.qr && design.warnings.includes('no_active_code')) return 'noActiveCode';
  if (design.state === 'validated') return design.scan_test === 'not_applicable' ? 'notApplicable' : 'passed';
  if (design.scan_test === 'failed') return 'failed';
  return 'needsTest';
}

/** Order, print files and "Herunterladen" need a validated version (contract §3 #11, §7). */
export function mayOrder(gate: ScanGate): boolean {
  return gate === 'passed' || gate === 'notApplicable';
}

export function mayRunScanTest(gate: ScanGate): boolean {
  return gate === 'needsTest' || gate === 'failed';
}

// -- Sizes (contract §2: millimetres per template)

export function sizeMm(
  state: DesignState,
  templates?: StickerTemplates | null,
): { width: number; height: number; qr: number | null } | null {
  const size = templates?.templates.find((entry) => entry.key === state.template)?.sizes.find((entry) => entry.key === state.options.size);
  if (!size) return null;
  return { width: size.width_mm, height: size.height_mm, qr: state.options.qr ? size.qr_mm : null };
}

/** The colourway's photo for "am Auto": white inks on dark glass, black ink on light paint (contract §2 substrates). */
export function substrateFor(colourway: StickerColourway): 'darkGlass' | 'lightPaint' {
  return colourway === 'black' ? 'lightPaint' : 'darkGlass';
}

// -- QA capture (DQ-M54-07): the editing states the matrix cannot tap to; never in production (`qa` has no overrides there)

const QA_TEMPLATES: Readonly<Record<string, StickerTemplateKey>> = {
  minimal: 'minimal',
  banner: 'banner',
  plate: 'plate',
  vertical: 'vertical_jdm',
  round: 'round',
};

/** The editor's first state under `qaDesigner`: another template, the QR code off or a custom line. `expanded` changes no content. */
export function qaDesignerState(state: DesignState, variant: string | undefined, line: string): DesignState {
  if (!variant) return state;
  const template = QA_TEMPLATES[variant];
  if (template) return { ...state, template };
  if (variant === 'qroff') return { ...state, options: { ...state.options, qr: false } };
  if (variant === 'line') return { ...state, options: { ...state.options, custom_line: line } };
  return state;
}

/** DQ-P5-205: the narrowest the drawing may get in the expanded detent (a portrait Vertical JDM fell to about 38 px). */
export const EXPANDED_MIN_DRAWN = 120;

/**
 * DQ-M54R2-01: with the dock expanded the stage keeps its full width; the drawing moves up into the part the dock leaves (`shift`) and
 * shrinks only as far as that part needs (`scale`, never above 1). The flat preview draws at min(width − 2·inset, (height − 2·inset) × ratio).
 *
 * DQ-P5-205: a portrait sticker (Vertical JDM) would shrink to a sliver there, too narrow to see what an option changed. When the
 * upright drawing would be narrower than `EXPANDED_MIN_DRAWN`:
 * - the flat preview (`rotatable`) lies down, a quarter turn (`rotate`), and fits its long side to the stage width, so the whole
 *   sticker stays in view and much larger;
 * - the other previews (a car photo, the ruler) keep that minimum width and are cropped by the dock instead.
 */
export function expandedPreviewFit(input: {
  stageWidth: number;
  stageHeight: number;
  cover: number;
  ratio: number;
  inset: number;
  rotatable?: boolean;
}): { scale: number; shift: number; rotate: boolean } {
  const { stageWidth, stageHeight, cover, inset, rotatable = false } = input;
  const ratio = input.ratio > 0 ? input.ratio : 1;
  const drawnHeight = Math.min(stageHeight - 2 * inset, (stageWidth - 2 * inset) / ratio);
  const drawnWidth = drawnHeight * ratio;
  const room = Math.max(0, stageHeight - cover) - 2 * inset;
  const shift = -cover / 2;
  if (drawnHeight <= 0) return { scale: 1, shift, rotate: false };
  const upright = Math.min(1, Math.max(0, room) / drawnHeight);
  if (ratio >= 1 || drawnWidth * upright >= EXPANDED_MIN_DRAWN) return { scale: upright, shift, rotate: false };
  if (rotatable) {
    // Lying down, the drawing is drawnHeight wide and drawnWidth high.
    const lying = Math.min(1, Math.max(0, stageWidth - 2 * inset) / drawnHeight, Math.max(0, room) / drawnWidth);
    if (lying > upright) return { scale: lying, shift, rotate: true };
  }
  return { scale: Math.max(upright, Math.min(1, EXPANDED_MIN_DRAWN / drawnWidth)), shift, rotate: false };
}
