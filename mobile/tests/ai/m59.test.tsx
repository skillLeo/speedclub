import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Platform, View } from 'react-native';

import { ApiError } from '@/api/client';
import { AI_FLAGS, type SpecSuggestion } from '@/api/queries/ai';
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { SpecsRequest } from '@/api/queries/garage';
import { memberSettingsKey } from '@/api/queries/settings';
import { quietAiNote, resetAiDayEndsForTests, SUGGESTION_FLAGS } from '@/features/ai/availability';
import { ProductMatchAssist } from '@/features/ai/ProductMatchAssist';
import { resetSpecsAssistForTests, SpecsAssist, specsPreview, specsPreviewParts, specSubject } from '@/features/ai/SpecsAssist';
import { ThreadSummary, resetThreadSummariesForTests } from '@/features/forum/components/ThreadSummary';
import { SpecsFields } from '@/features/garage/components/SpecsFields';
import { hasEmptySpecs, markedSpecs, specsValues, storedMarks, suggestedSpecs, takeSuggestion, type SpecsValues } from '@/features/garage/model';
import { useSpecChips } from '@/features/garage/specChips';
import { useSpecsSuggestion, type SpecsSuggestion } from '@/features/garage/specsSuggestion';
import { queryInText } from '@/features/parts/components/ModEditorParts';
import i18n from '@/i18n';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch, type Answer } from '../settings/harness';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), router: { push: jest.fn() }, usePathname: () => '/' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
/** DQ-P5-067: a test may set the window (its font scale); otherwise the preset's own. */
const mockWindow: { current: { width: number; height: number; scale: number; fontScale: number } | null } = { current: null };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => {
  const actual = jest.requireActual<{ default: () => { width: number; height: number; scale: number; fontScale: number } }>(
    'react-native/Libraries/Utilities/useWindowDimensions',
  );
  return {
    __esModule: true,
    default: () => {
      const real = actual.default();
      return mockWindow.current ?? real;
    },
  };
});
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ALL_FLAGS = { ...Object.fromEntries(Object.values(AI_FLAGS).map((flag) => [flag, true])), parts_catalogue: true, forum: true };

function aiClient({ flags = ALL_FLAGS, optIn = true }: { flags?: Record<string, boolean>; optIn?: boolean } = {}): QueryClient {
  const client = newQueryClient();
  client.setQueryData(appConfigKey, { config: { ...BUNDLED_APP_CONFIG, flags }, confirmed: true });
  client.setQueryData(memberSettingsKey, { ai_suggestions: optIn, power_display: 'ps_kw' });
  return client;
}

async function show(element: ReactElement, answers: Record<string, Answer | (() => Answer)>, options?: Parameters<typeof aiClient>[0]) {
  const stub = stubFetch(answers);
  await renderScreen(element, aiClient(options));
  await act(async () => undefined);
  return stub;
}

/** The requests to the AI endpoints (the harness also answers the app's own start-up requests). */
function aiCalls(calls: Request[]): Request[] {
  return calls.filter((request) => new URL(request.url).pathname.includes('/ai/'));
}

const VEHICLE = { id: '01vehicle', generation_id: 12, model_id: 3, model_year: 2004 };

const EMPTY: SpecsValues = specsValues(undefined, 'de');

function suggestion(variants: SpecSuggestion['variants']): { body: { data: SpecSuggestion } } {
  return {
    body: {
      data: {
        cache_id: '01jcachesuggestion0000000000',
        label: 'KI-Vorschlag',
        provenance_label: 'Herstellerangabe (KI-Vorschlag)',
        subject: 'BMW 3er E46 (1998–2006)',
        variants,
        cached: true,
        generated_at: '2026-11-16T10:00:00+01:00',
      },
    },
  };
}

const V320D = { key: '320d', label: '320d', fields: { power_value: 150, power_unit: 'ps', torque_nm: 330, fuel: 'diesel', drivetrain: 'rear', gearbox: 'manual' } };
const V330I = { key: '330i', label: '330i', fields: { power_value: 231, power_unit: 'ps', torque_nm: 300, fuel: 'petrol', drivetrain: 'rear' } };

beforeAll(hydrateThemePreference);
beforeEach(() => {
  useSessionStore.setState({ status: 'member' });
  resetAiDayEndsForTests();
  resetSpecsAssistForTests();
  resetThreadSummariesForTests();
  mockWindow.current = null;
});

describe('rules', () => {
  it('the new suggestion features sit behind the "KI-Vorschläge" opt-in, the summary does not', () => {
    expect(SUGGESTION_FLAGS).toEqual(expect.arrayContaining([AI_FLAGS.specs, AI_FLAGS.productMatch]));
    expect(SUGGESTION_FLAGS).not.toContain(AI_FLAGS.forumSummary);
  });

  it('reads a variant as the form shows it, power and torque as Herstellerangabe', () => {
    expect(suggestedSpecs({ ...V320D.fields, power_value: 110.5, displacement_cc: 1995, engine_code: 'M47D20', aspiration: 'warp' }, 'de')).toEqual({
      powerValue: '110,5',
      powerUnit: 'ps',
      powerSource: 'factory',
      torque: '330',
      torqueSource: 'factory',
      fuel: 'diesel',
      drivetrain: 'rear',
      gearbox: 'manual',
      displacement: '1995',
      engineCode: 'M47D20',
    });
  });

  it('fills only the empty fields; a filled power keeps its unit and source', () => {
    const current: SpecsValues = { ...EMPTY, powerValue: '163', powerUnit: 'ps', powerSource: 'measured', gearbox: 'automatic' };
    const taken = takeSuggestion(current, suggestedSpecs(V320D.fields, 'de'));
    expect(taken).toEqual({ torque: '330', torqueSource: 'factory', fuel: 'diesel', drivetrain: 'rear' });
    expect(hasEmptySpecs(current)).toBe(true);
  });

  it('a field keeps its mark only while it still shows the value; power also needs its unit and "Herstellerangabe"', () => {
    const marks = suggestedSpecs(V320D.fields, 'de');
    const values: SpecsValues = { ...EMPTY, ...marks };
    expect(markedSpecs(values, marks)).toEqual(['fuel', 'powerValue', 'torque', 'drivetrain', 'gearbox']);
    expect(markedSpecs({ ...values, powerValue: '155', torqueSource: 'measured' }, marks)).toEqual(['fuel', 'drivetrain', 'gearbox']);
    expect(markedSpecs({ ...values, powerUnit: 'kw' }, marks)).not.toContain('powerValue');
  });

  it('reads the stored marks from specs.ai_fields', () => {
    const specs = { power_value: 150, power_unit: 'ps', power_source: 'factory', torque_nm: 330, torque_source: 'factory', fuel: 'diesel', ai_fields: ['power_value', 'power_unit', 'fuel'] };
    expect(storedMarks(specs as never, 'de')).toEqual({ powerValue: '150', powerUnit: 'ps', powerSource: 'factory', fuel: 'diesel' });
    expect(storedMarks({ ...specs, ai_fields: [] } as never, 'de')).toEqual({});
  });

  it('asks for the generation, else the model with its year, else nothing', () => {
    expect(specSubject(VEHICLE)).toEqual({ generation_id: 12 });
    expect(specSubject({ ...VEHICLE, generation_id: null })).toEqual({ model_id: 3, model_year: 2004 });
    expect(specSubject({ generation_id: null, model_id: 3, model_year: null })).toBeNull();
  });

  it('previews a variant in the form’s words, a meta line that breaks after its "·" only (DQ-P5-059)', () => {
    expect(specsPreview(i18n.getFixedT('de', 'garage'), suggestedSpecs(V320D.fields, 'de'), 'de')).toBe(
      '150\u00A0PS\u00A0· 330\u00A0Nm\u00A0· Diesel\u00A0· Heck\u00A0· Schaltgetriebe',
    );
  });

  it('binds each figure to its unit and groups thousands per locale (DQ-P5-054)', () => {
    const fields = { power_value: 195, power_unit: 'ps', torque_nm: 230, displacement_cc: 2302 };
    const de = specsPreviewParts(i18n.getFixedT('de', 'garage'), suggestedSpecs(fields, 'de'), 'de');
    expect(de).toEqual(['195\u00A0PS', '230\u00A0Nm', '2.302\u00A0cm³']);
    const en = specsPreviewParts(i18n.getFixedT('en', 'garage'), suggestedSpecs(fields, 'en'), 'en');
    expect(en).toEqual(['195\u00A0PS', '230\u00A0Nm', '2,302\u00A0cm³']);
    // No plain space is left inside a part, so no line breaks between a figure and its unit.
    for (const part of [...de, ...en]) expect(part).not.toMatch(/ /);
  });

  it('the wizard preview chips bind each figure to its unit (DQ-P5-054)', async () => {
    function Chips() {
      const chips = useSpecChips({ powerValue: '195', powerUnit: 'ps', torque: '1250', drivetrain: 'rear' });
      return <View testID="chips" accessibilityLabel={chips.join('|')} />;
    }
    await show(<Chips />, {});
    expect(screen.getByTestId('chips').props.accessibilityLabel).toBe('195\u00A0PS|1.250\u00A0Nm|Heck');
  });

  it('keeps the provenance one label: no breakable space, no break after "KI-" (DQ-P5-053)', () => {
    expect(i18n.getFixedT('de', 'garage')('ai.specs.provenance')).toBe('Herstellerangabe (KI-\u2060Vorschlag)');
    expect(i18n.getFixedT('en', 'garage')('ai.specs.provenance')).toBe('Manufacturer figure (AI\u00A0suggestion)');
  });

  it('words the errors quietly: hide, "Kein Vorschlag gefunden", "Gerade nicht verfügbar"', () => {
    const t = i18n.getFixedT('de', 'common');
    const error = (code: string, kind: ApiError['kind'], status: number) => new ApiError({ kind, status, code, message: code });
    expect(quietAiNote(t, error('feature_disabled', 'not_found', 404))).toBeNull();
    expect(quietAiNote(t, error('ai_opt_in_required', 'forbidden', 403))).toBeNull();
    expect(quietAiNote(t, error('ai_unverifiable', 'validation', 422))).toMatchObject({ text: 'Kein Vorschlag gefunden.', retry: false });
    expect(quietAiNote(t, error('rate_limited', 'rate_limited', 429))).toMatchObject({ text: 'Gerade nicht verfügbar.', retry: true });
    expect(quietAiNote(t, error('ai_unavailable', 'server', 503))).toMatchObject({ text: 'Gerade nicht verfügbar.', retry: true });
    expect(quietAiNote(t, error('ai_daily_limit', 'rate_limited', 429))).toMatchObject({ retry: false });
  });
});

/** The spec form as GAR-03/GAR-06 hold it: SpecsAssist above SpecsFields, the suggestion state in between. */
function SpecsForm({ initial = EMPTY, onReady }: { initial?: SpecsValues; onReady?: (suggestion: SpecsSuggestion, values: () => SpecsValues) => void }) {
  const { control, getValues, setValue } = useForm<SpecsValues>({ defaultValues: initial });
  const suggestion = useSpecsSuggestion({ specs: undefined, locale: 'de', getValues, setValue, routeId: 'T' });
  onReady?.(suggestion, getValues);
  return (
    <View>
      <SpecsAssist vehicle={VEHICLE} open={hasEmptySpecs(initial)} getValues={getValues} onTake={suggestion.take} locale="de" saveLabel="Weiter" testID="T.specsSuggestion" />
      <SpecsFields control={control} routeId="T" marks={suggestion.marks} />
    </View>
  );
}

describe('GAR-03 / GAR-06 "Daten übernehmen?"', () => {
  it('shows nothing while the flag is off or without the opt-in', async () => {
    await show(<SpecsForm />, {}, { flags: {} });
    expect(screen.queryByTestId('T.specsSuggestion')).toBeNull();
    await show(<SpecsForm />, {}, { optIn: false });
    expect(screen.queryByTestId('T.specsSuggestion')).toBeNull();
  });

  it('asks with the label text, no request before "Ja"', async () => {
    const { calls } = await show(<SpecsForm />, { '/ai/specs/suggest': suggestion([V320D]) });
    expect(screen.getByText('Daten übernehmen?')).toBeTruthy();
    expect(screen.getByTestId('T.specsSuggestion.label')).toHaveTextContent('KI-⁠Vorschlag');
    expect(aiCalls(calls)).toHaveLength(0);
  });

  it('previews a single variant at 200 % without hyphenating its engine code, the name kept whole at its hyphen (DQ-P5-067)', async () => {
    mockWindow.current = { width: 393, height: 852, scale: 1, fontScale: 2 };
    const restore = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      const R34 = { key: 'r34', label: 'Skyline GT-R (RB26DETT)', fields: { power_value: 280, power_unit: 'ps', torque_nm: 392, fuel: 'petrol', drivetrain: 'awd' } };
      await show(<SpecsForm />, { '/ai/specs/suggest': suggestion([R34]) });
      await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
      const preview = await screen.findByTestId('T.specsSuggestion.preview');
      expect(preview.props.android_hyphenationFrequency).toBe('none');
      // "GT-R" never breaks at its hyphen; "(RB26DETT)" wraps whole to the next line ("Skyline GT-R / (RB26DETT) · …").
      expect(String(preview.props.children)).toMatch(/^Skyline GT-\u2060R \(RB26DETT\)\u00A0· 280\u00A0PS/);
    } finally {
      restore.restore();
    }
  });

  it('"Übernehmen" fills the empty fields, marked "Herstellerangabe (KI-Vorschlag)" until edited', async () => {
    let latest: SpecsSuggestion | null = null;
    const { calls } = await show(<SpecsForm initial={{ ...EMPTY, gearbox: 'automatic' }} onReady={(next) => (latest = next)} />, {
      '/ai/specs/suggest': suggestion([V320D]),
    });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    expect(await screen.findByTestId('T.specsSuggestion.preview')).toHaveTextContent(/^320d\s·\s150\sPS\s·\s330\sNm/);
    expect(JSON.parse(await aiCalls(calls)[0]!.clone().text())).toEqual({ generation_id: 12 });
    // Nothing is in the form before the confirmation.
    expect(screen.getByTestId('T.powerValue')).toHaveDisplayValue('');

    await fireEvent.press(screen.getByTestId('T.specsSuggestion.take'));
    await waitFor(() => expect(screen.getByTestId('T.powerValue')).toHaveDisplayValue('150'));
    expect(screen.getByTestId('T.torque')).toHaveDisplayValue('330');
    expect(screen.getByTestId('T.powerValue.helper')).toHaveTextContent(/Herstellerangabe \(KI-⁠Vorschlag\)/);
    expect(screen.getByTestId('T.torque.helper')).toHaveTextContent('Herstellerangabe (KI-⁠Vorschlag)');
    // The power helper breaks after its "·" only: the counterpart and the label are each one unbreakable part (DQ-P5-053).
    expect(screen.getByTestId('T.powerValue.helper').props.children).toBe('≈\u00A0110\u00A0kW\u00A0· Herstellerangabe (KI-\u2060Vorschlag)');
    // The member's own gearbox stays, without a mark.
    expect(screen.getByTestId('T.gearbox')).toHaveTextContent(/Automatik/);
    expect(screen.queryByTestId('T.gearbox.helper')).toBeNull();
    expect(screen.queryByTestId('T.specsSuggestion')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('T.torque'), '345');
    await waitFor(() => expect(screen.queryByTestId('T.torque.helper')).toBeNull());
    expect(screen.getByTestId('T.powerValue.helper')).toBeTruthy();

    // The save carries the suggestion it came from once.
    const save = jest.fn(async (body: SpecsRequest) => body);
    await act(async () => {
      await latest!.send(save, { power_value: 150 } as SpecsRequest);
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ ai_suggestion: { cache_id: '01jcachesuggestion0000000000', variant: '320d' } }));
  });

  it('several variants: a choice by label first, "Übernehmen" only after it', async () => {
    await show(<SpecsForm />, { '/ai/specs/suggest': suggestion([V320D, V330I]) });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    expect(await screen.findByTestId('T.specsSuggestion.variants')).toBeTruthy();
    expect(screen.getByTestId('T.specsSuggestion.take')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.variant.330i'));
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.take'));
    await waitFor(() => expect(screen.getByTestId('T.powerValue')).toHaveDisplayValue('231'));
  });

  it('"Nein danke" leaves every field as it was and does not ask again', async () => {
    const { calls } = await show(<SpecsForm />, { '/ai/specs/suggest': suggestion([V320D]) });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.decline'));
    expect(screen.queryByTestId('T.specsSuggestion')).toBeNull();
    expect(screen.getByTestId('T.powerValue')).toHaveDisplayValue('');
    expect(aiCalls(calls)).toHaveLength(0);
    await show(<SpecsForm />, { '/ai/specs/suggest': suggestion([V320D]) });
    expect(screen.queryByTestId('T.specsSuggestion')).toBeNull();
  });

  it('a skipped suggestion (loaded, not taken) changes nothing', async () => {
    await show(<SpecsForm />, { '/ai/specs/suggest': suggestion([V320D]) });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    await screen.findByTestId('T.specsSuggestion.take');
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.decline'));
    expect(screen.getByTestId('T.powerValue')).toHaveDisplayValue('');
    expect(screen.getByTestId('T.torque')).toHaveDisplayValue('');
  });

  it('hides on feature_disabled, says "Gerade nicht verfügbar" with a retry on 503, "Kein Vorschlag gefunden" on 422', async () => {
    await show(<SpecsForm />, { '/ai/specs/suggest': { status: 404, body: { message: 'x', code: 'feature_disabled' } } });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    await waitFor(() => expect(screen.queryByTestId('T.specsSuggestion')).toBeNull());

    await show(<SpecsForm />, { '/ai/specs/suggest': { status: 503, body: { message: 'x', code: 'ai_unavailable' } } });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    expect(await screen.findByText('Gerade nicht verfügbar.')).toBeTruthy();
    expect(screen.getByTestId('T.specsSuggestion.ask')).toHaveTextContent('Erneut versuchen');

    await show(<SpecsForm />, { '/ai/specs/suggest': { status: 422, body: { message: 'x', code: 'ai_unverifiable', errors: {} } } });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    expect(await screen.findByText('Kein Vorschlag gefunden.')).toBeTruthy();
    expect(screen.queryByTestId('T.specsSuggestion.ask')).toBeNull();
  });

  it('a suggestion the server no longer knows costs the save nothing: it goes again without it', async () => {
    let latest: SpecsSuggestion | null = null;
    await show(<SpecsForm onReady={(next) => (latest = next)} />, { '/ai/specs/suggest': suggestion([V320D]) });
    await fireEvent.press(screen.getByTestId('T.specsSuggestion.ask'));
    await fireEvent.press(await screen.findByTestId('T.specsSuggestion.take'));
    const expired = new ApiError({ kind: 'validation', status: 422, code: 'validation_failed', message: 'x', fieldErrors: { ai_suggestion: ['abgelaufen'] } });
    const save = jest.fn(async (body: SpecsRequest) => {
      if (body.ai_suggestion) throw expired;
      return body;
    });
    await act(async () => {
      await latest!.send(save, { power_value: 150 } as SpecsRequest);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).not.toHaveProperty('ai_suggestion');
  });
});

const PRODUCT = {
  id: '01jproductkw3000000000000000',
  name: 'Variant 3 Gewindefahrwerk',
  full_name: 'KW Variant 3 Gewindefahrwerk',
  line: null,
  brand: { name: 'KW', slug: 'kw' },
  category: { key: 'suspension', name: 'Fahrwerk', icon: 'suspension' },
};

describe('GAR-10 product match', () => {
  it('shows nothing while the flag is off or without the opt-in', async () => {
    await show(<ProductMatchAssist text="kw v3" category="suspension" onChoose={jest.fn()} testID="GAR-10.match" />, {}, { flags: { parts_catalogue: true } });
    expect(screen.queryByTestId('GAR-10.match')).toBeNull();
    await show(<ProductMatchAssist text="kw v3" category="suspension" onChoose={jest.fn()} testID="GAR-10.match" />, {}, { optIn: false });
    expect(screen.queryByTestId('GAR-10.match')).toBeNull();
  });

  it('asks on a tap, shows catalogue products with the label, and a pick links the product', async () => {
    const onChoose = jest.fn();
    const { calls } = await show(<ProductMatchAssist text="kw v3" category="suspension" onChoose={onChoose} testID="GAR-10.match" />, {
      '/ai/products/match': { body: { data: { label: 'KI-Vorschlag', normalized: 'KW Variant 3', products: [PRODUCT] } } },
    });
    expect(screen.getByTestId('GAR-10.match.actionLabel')).toHaveTextContent('KI-⁠Vorschlag');
    expect(aiCalls(calls)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('GAR-10.match.action'));
    expect(await screen.findByText('Meintest du KW Variant 3?')).toBeTruthy();
    // DQ-P5-068: the short last token stays with the word before it, so "3?" never opens a line.
    expect(String(screen.getByTestId('GAR-10.match.title').props.children)).toBe('Meintest du KW Variant\u00A03?');
    expect(screen.getByTestId('GAR-10.match.label')).toHaveTextContent('KI-Vorschlag');
    expect(JSON.parse(await aiCalls(calls)[0]!.clone().text())).toEqual({ text: 'kw v3', category_key: 'suspension' });
    await fireEvent.press(screen.getByTestId(`GAR-10.match.product.${PRODUCT.id}`));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: PRODUCT.id }));
  });

  it('keeps a short typed query whole inside its quotes, a long one breaks at its spaces only (DQ-P5-060 a)', () => {
    expect(queryInText('kw v3')).toBe('kw\u00A0v3');
    expect(queryInText('tein flex z')).toBe('tein\u00A0flex\u00A0z');
    expect(queryInText('H&R Cup-Kit')).toBe('H&R\u00A0Cup-\u2060Kit');
    expect(queryInText('Bilstein B16 Gewindefahrwerk komplett')).toBe('Bilstein B16 Gewindefahrwerk komplett');
  });

  it('nothing found: says so with the next step and offers no product', async () => {
    await show(<ProductMatchAssist text="kw v3" category={null} onChoose={jest.fn()} testID="GAR-10.match" />, {
      '/ai/products/match': { body: { data: { label: null, normalized: null, products: [] } } },
    });
    await fireEvent.press(screen.getByTestId('GAR-10.match.action'));
    // DQ-P5-060 b: the note names the next step instead of a second "nothing".
    expect(await screen.findByText('Kein Vorschlag gefunden. Trag Marke und Modell oben im Formular ein.')).toBeTruthy();
    expect(screen.queryByTestId('GAR-10.match.action')).toBeNull();
  });

  it('hides when the server switched it off', async () => {
    await show(<ProductMatchAssist text="kw v3" category={null} onChoose={jest.fn()} testID="GAR-10.match" />, {
      '/ai/products/match': { status: 404, body: { message: 'x', code: 'feature_disabled' } },
    });
    await fireEvent.press(screen.getByTestId('GAR-10.match.action'));
    await waitFor(() => expect(screen.queryByTestId('GAR-10.match')).toBeNull());
  });
});

const SUMMARY = {
  label: 'KI-Zusammenfassung',
  lines: ['Das Klappern kommt meist vom Stabi-Lager.', 'Neue Lager und Koppelstangen lösen es in den meisten Fällen.', 'Danach Spur prüfen lassen.'],
  based_on_replies: 24,
  generated_at: '2026-11-16T10:00:00+01:00',
};

describe('FOR-03 "KI-Zusammenfassung"', () => {
  it('is hidden without a summary or while the flag is off; needs no opt-in and no member', async () => {
    await show(<ThreadSummary thread={{ id: '01jthread', ai_summary: null }} routeId="FOR-03" />, {});
    expect(screen.queryByTestId('FOR-03.summary')).toBeNull();
    await show(<ThreadSummary thread={{ id: '01jthread', ai_summary: SUMMARY }} routeId="FOR-03" />, {}, { flags: { forum: true } });
    expect(screen.queryByTestId('FOR-03.summary')).toBeNull();
    useSessionStore.setState({ status: 'guest' });
    await show(<ThreadSummary thread={{ id: '01jthread', ai_summary: SUMMARY }} routeId="FOR-03" />, {}, { optIn: false });
    expect(screen.getByTestId('FOR-03.summary.label')).toHaveTextContent('KI-Zusammenfassung');
  });

  it('starts collapsed, opens to its three lines, and goes away with "×"', async () => {
    await show(<ThreadSummary thread={{ id: '01jthread', ai_summary: SUMMARY }} routeId="FOR-03" />, {});
    expect(screen.getByText('aus 24 Antworten')).toBeTruthy();
    expect(screen.queryByTestId('FOR-03.summary.body')).toBeNull();
    await fireEvent.press(screen.getByTestId('FOR-03.summary.toggle'));
    expect(screen.getByTestId('FOR-03.summary.line.2')).toHaveTextContent('Danach Spur prüfen lassen.');
    expect(screen.getByTestId('FOR-03.summary.toggle')).toBeExpanded();
    await fireEvent.press(screen.getByTestId('FOR-03.summary.hide'));
    expect(screen.queryByTestId('FOR-03.summary')).toBeNull();
  });
});
