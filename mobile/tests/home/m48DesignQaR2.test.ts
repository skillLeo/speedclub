// M4.8 design QA round 2: notes without the kind prefix (DQ-1085), the offline line with its time (DQ-1044), DISC-03 models without
// a photo out of the grid (DQ-1082).
import { changeCaption, isAuthoredKind } from '@/features/home/components/HomeFeedCard';
import { offlineLine } from '@/features/home/model';
import { splitByCover } from '@/features/discover/screens/MakeScreen';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

describe('DQ-1085 a note is the member’s own words', () => {
  it('drops the kind before a note or post, keeps it before a change', () => {
    expect(changeCaption({ type_label: 'Notiz', summary: 'Bremse eingefahren, alles ruhig.' })).toBe('Bremse eingefahren, alles ruhig.');
    expect(changeCaption({ type_label: 'Note', summary: 'Brakes bedded in.' })).toBe('Brakes bedded in.');
    expect(changeCaption({ type_label: 'Update', summary: 'Neu im Build-Sheet: Bilstein B16' })).not.toMatch(/^Update:/);
    expect(changeCaption({ type_label: 'Fahrwerk geändert', summary: 'KW V3' })).toBe('Fahrwerk geändert: KW V3');
    expect(changeCaption({ type_label: 'Notiz', summary: '' })).toBe('Notiz');
    expect(isAuthoredKind(' Notiz ')).toBe(true);
    expect(isAuthoredKind('Fotos hinzugefügt')).toBe(false);
  });
});

describe('DQ-1044 the offline line says when the page was loaded', () => {
  const t = (key: string, options?: Record<string, string>) => (key === 'offlineSince' ? `zuletzt aktualisiert ${options?.time ?? ''}` : 'offline');
  it('names the last read, or falls back before one', () => {
    expect(offlineLine(t, Date.UTC(2026, 10, 12, 10, 0), () => 'vor 5 Min.')).toBe('zuletzt aktualisiert vor 5 Min.');
    expect(offlineLine(t, 0, () => 'never')).toBe('offline');
  });
});

describe('DQ-1082 DISC-03 models without a photo', () => {
  const models = [{ slug: 'supra' }, { slug: 'gt86' }, { slug: 'ae86' }];
  it('moves them under the grid once the builds are in', () => {
    const covers = new Map([['supra', {}], ['ae86', {}]]);
    expect(splitByCover(models, covers, true)).toEqual({ grid: [{ slug: 'supra' }, { slug: 'ae86' }], more: [{ slug: 'gt86' }] });
  });
  it('keeps every model in the grid while the builds load, or when none has a photo', () => {
    expect(splitByCover(models, new Map(), false).more).toEqual([]);
    expect(splitByCover(models, new Map(), true)).toEqual({ grid: models, more: [] });
  });
});
