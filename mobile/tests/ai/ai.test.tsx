import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { ApiError } from '@/api/client';
import { AI_FLAGS } from '@/api/queries/ai';
import { appConfigKey, BUNDLED_APP_CONFIG } from '@/api/queries/appConfig';
import type { ModCategoryField } from '@/api/queries/catalog';
import { memberSettingsKey } from '@/api/queries/settings';
import { AiSearchAction } from '@/features/ai/AiSearchAction';
import { aiErrorMessage, resetAiDayEndsForTests } from '@/features/ai/availability';
import { DescriptionAssist } from '@/features/ai/DescriptionAssist';
import { ModAssist, suggestionText } from '@/features/ai/ModAssist';
import { PhotoCategoryAssist } from '@/features/ai/PhotoCategoryAssist';
import { aiChipParams } from '@/features/ai/search';
import { TranslatableText } from '@/features/ai/TranslatableText';
import i18n from '@/i18n';
import * as toastModule from '@/ui/toast';
import { useSessionStore } from '@/state/session';
import { hydrateThemePreference } from '@/theme';

import { newQueryClient, renderScreen, stubFetch, type Answer } from '../settings/harness';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), router: { push: (...args: unknown[]) => mockPush(...args) }, usePathname: () => '/' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

const ALL_FLAGS = Object.fromEntries(Object.values(AI_FLAGS).map((flag) => [flag, true]));

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

beforeAll(hydrateThemePreference);
beforeEach(() => {
  useSessionStore.setState({ status: 'member' });
  resetAiDayEndsForTests();
});

describe('helpers', () => {
  it('turns the chips into the search parameters, several values with a comma', () => {
    expect(
      aiChipParams([
        { facet: 'make', value: 'bmw', label: 'BMW' },
        { facet: 'wheel_diameter', value: '19', label: '19″' },
        { facet: 'wheel_diameter', value: '20', label: '20″' },
        { facet: 'wheel_diameter', value: '19', label: '19″' },
      ]),
    ).toEqual({ make: 'bmw', wheel_diameter: '19,20' });
  });

  it('words every AI error, never a code', () => {
    const t = i18n.getFixedT('de', 'common');
    const error = (code: string, kind: ApiError['kind'], status: number) => new ApiError({ kind, status, code, message: code });
    expect(aiErrorMessage(t, error('ai_budget_exhausted', 'server', 503))).toMatch(/Für heute/);
    expect(aiErrorMessage(t, error('ai_unverifiable', 'validation', 422))).toMatch(/nicht mit deinen Angaben belegen/);
    expect(aiErrorMessage(t, error('rate_limited', 'rate_limited', 429))).toMatch(/viele Vorschläge/);
    expect(aiErrorMessage(t, error('ai_opt_in_required', 'forbidden', 403))).toMatch(/KI-Vorschläge/);
    // ADR-252: the member's share of the daily budget, and the verified address, each in their own words.
    expect(aiErrorMessage(t, error('ai_daily_limit', 'rate_limited', 429))).toMatch(/Tageskontingent/);
    expect(aiErrorMessage(t, error('email_not_verified', 'forbidden', 403))).toMatch(/bestätigte E-Mail-Adresse/);
    expect(aiErrorMessage(i18n.getFixedT('en', 'common'), error('ai_daily_limit', 'rate_limited', 429))).toMatch(/allowance/);
    expect(aiErrorMessage(t, new Error('x'))).toMatch(/nicht geklappt/);
  });

  it('reads a suggested value as the form would show it', () => {
    const select = { type: 'select', unit: null, options: [{ value: 'coilover', label: 'Gewindefahrwerk' }] } as Pick<ModCategoryField, 'type' | 'options' | 'unit'>;
    expect(suggestionText(select, 'coilover', 'de', ['Ja', 'Nein'])).toBe('Gewindefahrwerk');
    expect(suggestionText({ type: 'number', unit: 'mm', options: null } as Pick<ModCategoryField, 'type' | 'options' | 'unit'>, 35.5, 'de', ['Ja', 'Nein'])).toBe('35,5 mm');
    expect(suggestionText({ type: 'boolean', unit: null, options: null } as Pick<ModCategoryField, 'type' | 'options' | 'unit'>, true, 'de', ['Ja', 'Nein'])).toBe('Ja');
  });
});

describe('flags and opt-in', () => {
  it('shows nothing while the flag is off, without the opt-in, or for a guest', async () => {
    await show(<AiSearchAction text="schwarze M4" onApply={jest.fn()} testID="DISC-02.ai" />, {}, { flags: {} });
    expect(screen.queryByTestId('DISC-02.ai')).toBeNull();
    await show(<AiSearchAction text="schwarze M4" onApply={jest.fn()} testID="DISC-02.ai" />, {}, { optIn: false });
    expect(screen.queryByTestId('DISC-02.ai')).toBeNull();
    useSessionStore.setState({ status: 'guest' });
    await show(<AiSearchAction text="schwarze M4" onApply={jest.fn()} testID="DISC-02.ai" />, {});
    expect(screen.queryByTestId('DISC-02.ai')).toBeNull();
  });

  it('translation needs the flag but no opt-in', async () => {
    await show(<TranslatableText source="vehicle_description" id="01veh" text="Mein Alltagsauto." testID="VEH-01.description" />, {}, { optIn: false });
    expect(screen.getByTestId('VEH-01.description.translate.action')).toBeTruthy();
  });
});

describe('DISC-02 "Mit KI suchen"', () => {
  it('hands the chips and the label to the screen', async () => {
    const onApply = jest.fn();
    const chips = [{ facet: 'model', value: 'bmw--m4', label: 'BMW M4' }];
    const { calls } = await show(<AiSearchAction text="schwarze M4" onApply={onApply} testID="DISC-02.ai" />, {
      '/ai/search/interpret': { body: { data: { chips, label: 'KI-Vorschlag' } } },
    });
    await fireEvent.press(screen.getByTestId('DISC-02.ai.action'));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(chips, 'KI-Vorschlag'));
    expect(await calls.find((request) => request.url.endsWith('/ai/search/interpret'))?.json()).toEqual({ q: 'schwarze M4' });
  });

  it('says so when nothing matched, and disappears when the server turned it off', async () => {
    await show(<AiSearchAction text="irgendwas" onApply={jest.fn()} testID="DISC-02.ai" />, {
      '/ai/search/interpret': { body: { data: { chips: [], label: 'KI-Vorschlag' } } },
    });
    await fireEvent.press(screen.getByTestId('DISC-02.ai.action'));
    expect(await screen.findByTestId('DISC-02.ai.note')).toHaveTextContent(/keine passenden Filter/);

    await show(<AiSearchAction text="irgendwas" onApply={jest.fn()} testID="DISC-02.off" />, {
      '/ai/search/interpret': { status: 404, body: { message: 'Aus', code: 'feature_disabled', errors: {} } },
    });
    await fireEvent.press(screen.getByTestId('DISC-02.off.action'));
    await waitFor(() => expect(screen.queryByTestId('DISC-02.off')).toBeNull());
  });
});

describe('VEH-01 / build update / MSG-02 "Übersetzen"', () => {
  it('shows the translation with its label and switches back to the original', async () => {
    const { calls } = await show(<TranslatableText source="build_update" id="01upd" text="Fahrwerk getauscht." testID="VEH-04.note" />, {
      '/ai/translate': { body: { data: { text: 'Suspension swapped.', to: 'de', label: 'Übersetzt', cached: false } } },
    });
    await fireEvent.press(screen.getByTestId('VEH-04.note.translate.action'));
    expect(await screen.findByText('Suspension swapped.')).toBeTruthy();
    expect(screen.getByTestId('VEH-04.note.translate.label')).toHaveTextContent('Übersetzt');
    expect(await calls.find((request) => request.url.endsWith('/ai/translate'))?.json()).toEqual({ source: 'build_update', id: '01upd', to: 'de' });
    await fireEvent.press(screen.getByTestId('VEH-04.note.translate.toggle'));
    expect(screen.getByText('Fahrwerk getauscht.')).toBeTruthy();
    expect(screen.queryByTestId('VEH-04.note.translate.label')).toBeNull();
  });

  it('a rate limit leaves the original with "Erneut übersetzen"', async () => {
    await show(<TranslatableText source="message" id="01msg" text="Servus!" testID="MSG-02.m" />, {
      '/ai/translate': { status: 429, body: { message: 'Zu viele', code: 'rate_limited', errors: {} } },
    });
    await fireEvent.press(screen.getByTestId('MSG-02.m.translate.action'));
    await waitFor(() => expect(screen.getByTestId('MSG-02.m.translate.action')).toHaveTextContent('Erneut übersetzen'));
    expect(screen.getByText('Servus!')).toBeTruthy();
  });
});

describe('GAR-10 "Aus Text übernehmen"', () => {
  const FIELDS = [
    { key: 'brand', label: 'Marke', type: 'text', unit: null, options: null },
    { key: 'lowering_front', label: 'Tieferlegung vorn', type: 'number', unit: 'mm', options: null },
  ] as unknown as ModCategoryField[];

  it('offers each suggested value on its own; nothing is taken without a tap', async () => {
    const onAccept = jest.fn();
    await show(<ModAssist categoryKey="suspension" fields={FIELDS} locale="de" onAccept={onAccept} testID="GAR-10.ai" />, {
      '/ai/mods/suggest': { body: { data: { category_key: 'suspension', fields: { brand: 'KW', lowering_front: 35 }, label: 'KI-Vorschlag' } } },
    });
    await fireEvent.press(screen.getByTestId('GAR-10.ai.open'));
    await fireEvent.changeText(screen.getByTestId('GAR-10.ai.text'), 'KW V3 Gewindefahrwerk, -35 mm vorn');
    await fireEvent.press(screen.getByTestId('GAR-10.ai.suggest'));
    expect(await screen.findByTestId('GAR-10.ai.label')).toHaveTextContent('KI-Vorschlag');
    expect(screen.getByText('35 mm')).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('GAR-10.ai.discard.lowering_front'));
    await fireEvent.press(screen.getByTestId('GAR-10.ai.accept.brand'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(FIELDS[0], 'KW');
  });
});

describe('GAR-03 "Beschreibung vorschlagen"', () => {
  it('puts the text into the field, labelled', async () => {
    const onSuggest = jest.fn();
    await show(<DescriptionAssist vehicleId="01veh" value="" onSuggest={onSuggest} testID="GAR-03.ai" />, {
      '/description': { body: { data: { text: 'BMW M4 Competition von 2021.', label: 'KI-Vorschlag' } } },
    });
    await fireEvent.press(screen.getByTestId('GAR-03.ai.action'));
    await waitFor(() => expect(onSuggest).toHaveBeenCalledWith('BMW M4 Competition von 2021.'));
  });

  it('an unverifiable answer says why and changes nothing', async () => {
    const onSuggest = jest.fn();
    await show(<DescriptionAssist vehicleId="01veh" value="" onSuggest={onSuggest} testID="GAR-03.ai" />, {
      '/description': { status: 422, body: { message: 'x', code: 'ai_unverifiable', errors: {} } },
    });
    await fireEvent.press(screen.getByTestId('GAR-03.ai.action'));
    expect(await screen.findByText(/nicht mit deinen Angaben belegen/)).toBeTruthy();
    expect(onSuggest).not.toHaveBeenCalled();
  });
});

describe('GAR-08 category suggestion', () => {
  it('asks only on a tap, once, and offers the category to take (ADR-242)', async () => {
    const onAccept = jest.fn();
    const { calls } = await show(<PhotoCategoryAssist mediaId="01med" current="exterior" onAccept={onAccept} testID="GAR-08.ai" />, {
      '/category': { body: { data: { category: 'interior', category_label: 'Innenraum', label: 'KI-Vorschlag' } } },
    });
    // Opening the screen sends nothing to the provider.
    expect(calls.filter((request) => request.url.endsWith('/category'))).toHaveLength(0);
    expect(screen.getByTestId('GAR-08.ai.action')).toHaveTextContent('Kategorie vorschlagen');
    await fireEvent.press(screen.getByTestId('GAR-08.ai.action'));
    expect(await screen.findByTestId('GAR-08.ai.label')).toHaveTextContent('KI-Vorschlag: Innenraum');
    await fireEvent.press(screen.getByTestId('GAR-08.ai.accept'));
    expect(onAccept).toHaveBeenCalledWith('interior');
    expect(calls.filter((request) => request.url.endsWith('/category'))).toHaveLength(1);
  });

  it('a photo still processing gets a retry', async () => {
    await show(<PhotoCategoryAssist mediaId="01med" current="exterior" onAccept={jest.fn()} testID="GAR-08.ai" />, {
      '/category': { status: 409, body: { message: 'x', code: 'media_processing', errors: {} } },
    });
    await fireEvent.press(screen.getByTestId('GAR-08.ai.action'));
    expect(await screen.findByTestId('GAR-08.ai.note')).toHaveTextContent(/noch verarbeitet/);
    expect(screen.getByTestId('GAR-08.ai.retry')).toBeTruthy();
  });
});

describe('verified address and daily share (ADR-252)', () => {
  it('an unverified address leads to the verification, on every suggestion surface', async () => {
    const refused = { status: 403, body: { message: 'x', code: 'email_not_verified', errors: {} } };
    await show(<PhotoCategoryAssist mediaId="01med" current="exterior" onAccept={jest.fn()} testID="GAR-08.ai" />, { '/category': refused });
    await fireEvent.press(screen.getByTestId('GAR-08.ai.action'));
    expect(await screen.findByTestId('GAR-08.ai.note')).toHaveTextContent(/bestätigte E-Mail-Adresse/);
    await fireEvent.press(screen.getByTestId('GAR-08.ai.verify'));
    expect(mockPush).toHaveBeenCalledWith('/verify-email');

    await show(<AiSearchAction text="schwarze M4" onApply={jest.fn()} testID="DISC-02.ai" />, { '/ai/search/interpret': refused });
    await fireEvent.press(screen.getByTestId('DISC-02.ai.action'));
    expect(await screen.findByTestId('DISC-02.ai.verify')).toBeTruthy();

    await show(<DescriptionAssist vehicleId="01veh" value="" onSuggest={jest.fn()} testID="GAR-03.ai" />, { '/description': refused });
    await fireEvent.press(screen.getByTestId('GAR-03.ai.action'));
    expect(await screen.findByTestId('GAR-03.ai.verify')).toBeTruthy();
  });

  it('a translation refused for the address offers the verification in its toast', async () => {
    const shown = jest.spyOn(toastModule, 'toast');
    await show(<TranslatableText source="message" id="01msg" text="Servus!" testID="MSG-02.m" />, {
      '/ai/translate': { status: 403, body: { message: 'x', code: 'email_not_verified', errors: {} } },
    });
    await fireEvent.press(screen.getByTestId('MSG-02.m.translate.action'));
    await waitFor(() => expect(shown).toHaveBeenCalled());
    const [message, options] = shown.mock.calls.at(-1)!;
    expect(message).toMatch(/bestätigte E-Mail-Adresse/);
    expect(options?.action?.label).toBe('E-Mail-Adresse bestätigen');
    options?.action?.onPress();
    expect(mockPush).toHaveBeenCalledWith('/verify-email');
    shown.mockRestore();
  });

  it('the daily share says so instead of a generic rate limit', async () => {
    await show(<AiSearchAction text="schwarze M4" onApply={jest.fn()} testID="DISC-02.ai" />, {
      '/ai/search/interpret': { status: 429, body: { message: 'x', code: 'ai_daily_limit', errors: {} } },
    });
    await fireEvent.press(screen.getByTestId('DISC-02.ai.action'));
    expect(await screen.findByTestId('DISC-02.ai.note')).toHaveTextContent(/Tageskontingent/);
    expect(screen.queryByTestId('DISC-02.ai.verify')).toBeNull();
  });
});

// Code review phase-3-final SF-6: once a feature is used up for today, every further tap would fail the same way.
describe('used up for today (429 ai_daily_limit, 503 ai_budget_exhausted)', () => {
  const dailyLimit = { status: 429, body: { message: 'x', code: 'ai_daily_limit', errors: {} } };
  const budget = { status: 503, body: { message: 'x', code: 'ai_budget_exhausted', errors: {} } };
  const asMember = (id: string) => useSessionStore.setState({ status: 'member', member: { id, username: id, displayName: null, avatarUrl: null } });
  const count = (calls: Request[], path: string) => calls.filter((request) => request.url.endsWith(path)).length;

  it('GAR-08 shows the limit only: no "Erneut versuchen", also on the next photo', async () => {
    const { calls } = await show(<PhotoCategoryAssist mediaId="01med" current="exterior" onAccept={jest.fn()} testID="GAR-08.ai" />, { '/category': dailyLimit });
    await fireEvent.press(screen.getByTestId('GAR-08.ai.action'));
    expect(await screen.findByTestId('GAR-08.ai.note')).toHaveTextContent(/Tageskontingent/);
    expect(screen.queryByTestId('GAR-08.ai.retry')).toBeNull();
    expect(screen.queryByTestId('GAR-08.ai.action')).toBeNull();
    expect(screen.queryByText('Erneut versuchen')).toBeNull();

    expect(count(calls, '/category')).toBe(1);

    // The next photo (a new mount) asks nothing and says the same.
    await cleanup();
    const next = await show(<PhotoCategoryAssist mediaId="01med2" current="exterior" onAccept={jest.fn()} testID="GAR-08.ai" />, { '/category': dailyLimit });
    expect(screen.getByTestId('GAR-08.ai.note')).toHaveTextContent(/Tageskontingent/);
    expect(screen.queryByTestId('GAR-08.ai.action')).toBeNull();
    expect(count(next.calls, '/category')).toBe(0);
  });

  it('DISC-02 drops "Mit KI suchen" for the member, and another member still gets it', async () => {
    asMember('01mem');
    await show(<AiSearchAction text="schwarze M4" onApply={jest.fn()} testID="DISC-02.ai" />, { '/ai/search/interpret': dailyLimit });
    await fireEvent.press(screen.getByTestId('DISC-02.ai.action'));
    expect(await screen.findByTestId('DISC-02.ai.note')).toHaveTextContent(/Tageskontingent/);
    expect(screen.queryByTestId('DISC-02.ai.action')).toBeNull();

    // The share is the member's: another member signed in on the device is offered the action again.
    await act(async () => asMember('01other'));
    expect(screen.getByTestId('DISC-02.ai.action')).toBeTruthy();
  });

  it('GAR-03 says the budget is spent and offers no action', async () => {
    const { calls } = await show(<DescriptionAssist vehicleId="01veh" value="" onSuggest={jest.fn()} testID="GAR-03.ai" />, { '/description': budget });
    await fireEvent.press(screen.getByTestId('GAR-03.ai.action'));
    expect(await screen.findByTestId('GAR-03.ai.note')).toHaveTextContent(/Für heute/);
    expect(screen.queryByTestId('GAR-03.ai.action')).toBeNull();
    expect(count(calls, '/description')).toBe(1);
  });

  it('GAR-10 keeps "Verwerfen" but no "Vorschlagen", also after closing and opening', async () => {
    const fields = [{ key: 'brand', label: 'Marke', type: 'text', unit: null, options: null }] as unknown as ModCategoryField[];
    await show(<ModAssist categoryKey="suspension" fields={fields} locale="de" onAccept={jest.fn()} testID="GAR-10.ai" />, { '/ai/mods/suggest': dailyLimit });
    await fireEvent.press(screen.getByTestId('GAR-10.ai.open'));
    await fireEvent.changeText(screen.getByTestId('GAR-10.ai.text'), 'KW V3 Gewindefahrwerk');
    await fireEvent.press(screen.getByTestId('GAR-10.ai.suggest'));
    expect(await screen.findByTestId('GAR-10.ai.note')).toHaveTextContent(/Tageskontingent/);
    expect(screen.queryByTestId('GAR-10.ai.suggest')).toBeNull();
    await fireEvent.press(screen.getByTestId('GAR-10.ai.close'));
    expect(screen.queryByTestId('GAR-10.ai.open')).toBeNull();
    expect(screen.getByTestId('GAR-10.ai.note')).toHaveTextContent(/Tageskontingent/);
  });

  it('translation says it in the toast and then offers no "Erneut übersetzen"', async () => {
    const shown = jest.spyOn(toastModule, 'toast');
    await show(<TranslatableText source="message" id="01msg" text="Servus!" testID="MSG-02.m" />, { '/ai/translate': dailyLimit });
    await fireEvent.press(screen.getByTestId('MSG-02.m.translate.action'));
    await waitFor(() => expect(shown).toHaveBeenCalled());
    expect(shown.mock.calls.at(-1)![0]).toMatch(/Tageskontingent/);
    await waitFor(() => expect(screen.queryByTestId('MSG-02.m.translate.action')).toBeNull());
    expect(screen.queryByText('Erneut übersetzen')).toBeNull();
    expect(screen.getByText('Servus!')).toBeTruthy();
    shown.mockRestore();
  });
});
