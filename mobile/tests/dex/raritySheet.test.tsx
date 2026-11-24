import { screen } from '@testing-library/react-native';

import { rarityRulesOf } from '@/api/queries/dex';
import { RaritySheet } from '@/features/dex/components/RaritySheet';
import { hydrateThemePreference } from '@/theme';

import { renderScreen, stubFetch } from './helpers';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('@/api/client', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://speedclub.test';
  return jest.requireActual('@/api/client');
});

/** GET rarity-rules as the live server answers it. */
const RULES = { data: { tuned: { min_build_score: 500 }, rare: { max_same_generation: 5 }, legend: { min_build_score: 850, unique_generation: true }, ghost: { opt_in: true } } };

beforeAll(hydrateThemePreference);

describe('So entsteht die Rarität', () => {
  it('names the five tiers with the configured thresholds in plain German', async () => {
    stubFetch({ '/rarity-rules': { body: RULES } });
    await renderScreen(<RaritySheet visible onClose={jest.fn()} testID="DEX-01.raritySheet" />);
    expect(await screen.findByText('Build Score ab 500.')).toBeTruthy();
    expect(screen.getByText('Höchstens 5 öffentliche Autos derselben Generation bei Speedclub.')).toBeTruthy();
    expect(screen.getByText('Das einzige öffentliche Auto seiner Generation oder Build Score ab 850.')).toBeTruthy();
    expect(screen.getByText('Jedes Auto startet hier.')).toBeTruthy();
    expect(screen.getByText(/Ghost-Modus/)).toBeTruthy();
    for (const tier of ['street', 'tuned', 'rare', 'legend', 'ghost']) expect(screen.getByTestId(`DEX-01.raritySheet.rule.${tier}`)).toBeTruthy();
  });

  it('says when the rules cannot be loaded and offers a retry', async () => {
    stubFetch({ '/rarity-rules': { status: 404, body: { message: 'x', code: 'not_found', errors: {} } } });
    await renderScreen(<RaritySheet visible onClose={jest.fn()} testID="DEX-03.raritySheet" />);
    expect(await screen.findByTestId('DEX-03.raritySheet.error')).toBeTruthy();
  });

  it('reads the thresholds of the rules resource', () => {
    expect(rarityRulesOf(RULES.data)).toEqual({ tunedScore: 500, rareMax: 5, legendScore: 850 });
  });
});
