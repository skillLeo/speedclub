import {
  changeEffects,
  createBody,
  emptyValues,
  eventSchema,
  instantOf,
  maskDate,
  maskTime,
  parseDay,
  stepOf,
  updateBody,
  type EventFormValues,
} from '@/features/events/schemas';
import { mapState, parseMapMessage, mapHtml, MAPLIBRE_SCRIPT } from '@/features/events/map/mapConfig';
import { getTheme } from '@/theme/theme';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const NOW = new Date('2026-06-01T10:00:00Z');

function filled(extra: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...emptyValues(),
    title: 'Cars & Coffee Hafen',
    city: 'Hamburg',
    venue: 'Parkplatz am Kai',
    lat: 53.5413,
    lng: 9.9845,
    startDate: '13.06.2026',
    startTime: '18:00',
    endTime: '21:00',
    acceptRules: true,
    ...extra,
  };
}

const issues = (values: EventFormValues, create = true) => {
  const result = eventSchema(NOW, create).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
};

describe('EVT-03 typing', () => {
  it('masks dates and times while typing', () => {
    expect(maskDate('13062026')).toBe('13.06.2026');
    expect(maskDate('1306')).toBe('13.06');
    expect(maskTime('1830')).toBe('18:30');
  });

  it('accepts only real days', () => {
    expect(parseDay('29.02.2028')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDay('29.02.2027')).toBeNull();
    expect(parseDay('2026-06-13')).toBeNull();
  });

  it('reads the typed time as Berlin time', () => {
    expect(instantOf('13.06.2026', '18:00')?.toISOString()).toBe('2026-06-13T16:00:00.000Z');
  });
});

describe('EVT-03 rules', () => {
  it('passes a complete event', () => {
    expect(issues(filled())).toEqual({});
  });

  it('refuses a start in the past, an end before the start and more than four days', () => {
    expect(issues(filled({ startDate: '31.05.2026' })).startDate).toBe('validation.past');
    expect(issues(filled({ endTime: '17:00' })).endTime).toBe('validation.endBeforeStart');
    expect(issues(filled({ endDate: '20.06.2026' })).endTime).toBe('validation.tooLong');
  });

  it('needs the pin, the city and "Nur legal"', () => {
    const missing = issues(filled({ lat: null, lng: null, city: '', rules: [] }));
    expect(missing.lat).toBe('validation.pin');
    expect(missing.city).toBe('validation.required');
    expect(missing.rules).toBe('editor.legalRequired');
  });

  it('asks a new event for the accepted rules, not a change', () => {
    expect(issues(filled({ acceptRules: false })).acceptRules).toBe('editor.acceptRulesRequired');
    expect(issues(filled({ acceptRules: false }), false).acceptRules).toBeUndefined();
  });

  it('finds the step a server field lives on', () => {
    expect(stepOf('startDate')).toBe('time');
    expect(stepOf('lat')).toBe('place');
    expect(stepOf('acceptRules')).toBe('details');
  });
});

describe('EVT-03 bodies', () => {
  it('creates a draft first, with the rules accepted and the times as instants', () => {
    const body = createBody(filled({ capacity: '1.200' }));
    expect(body).toMatchObject({
      title: 'Cars & Coffee Hafen',
      starts_at: '2026-06-13T16:00:00.000Z',
      ends_at: '2026-06-13T19:00:00.000Z',
      venue_name: 'Parkplatz am Kai',
      capacity: 1200,
      rules: ['legal_only'],
      accept_rules: true,
      submit: false,
    });
  });

  it('sends only what changed, and never a locked place visibility (ADR-437 d)', () => {
    const before = filled();
    const body = updateBody(filled({ startTime: '19:00', locationVisibility: 'after_rsvp' }), before, true);
    expect(Object.keys(body)).toEqual(['starts_at']);
    expect(changeEffects(body)).toEqual({ notifies: true, reviewFields: false });
    expect(changeEffects(updateBody(filled({ title: 'Neuer Titel' }), before, true))).toEqual({
      notifies: false,
      reviewFields: true,
    });
  });
});

describe('the map (ADR-411)', () => {
  it('draws with token colours, the dark style on Carbon and the light one on Hell', () => {
    const carbon = mapState(
      { mode: 'pins', center: null, attribution: '© OpenStreetMap' },
      getTheme('carbon'),
      false,
    );
    expect(carbon.styleUrl).toContain('/styles/dark');
    expect(carbon.colors.canvas).toBe(getTheme('carbon').color.bg.canvas);
    expect(carbon.zoom).toBeLessThan(8);
    expect(
      mapState({ mode: 'pins', center: null, attribution: '' }, getTheme('light'), true).styleUrl,
    ).toContain('/styles/positron');
  });

  it('accepts only the controller messages it knows', () => {
    expect(parseMapMessage('{"type":"select","id":"e1"}')).toEqual({ type: 'select', id: 'e1' });
    expect(parseMapMessage({ type: 'view', bbox: [9, 53, 10, 54] })).toEqual({
      type: 'view',
      bbox: [9, 53, 10, 54],
    });
    expect(parseMapMessage({ type: 'view', bbox: [9, 53] })).toBeNull();
    expect(parseMapMessage('not json')).toBeNull();
    expect(parseMapMessage({ type: 'eval', code: 'x' })).toBeNull();
  });

  it('loads MapLibre with its integrity and escapes the state', () => {
    const state = mapState(
      { mode: 'snippet', center: { lat: 1, lng: 2 }, attribution: '</script><b>' },
      getTheme('carbon'),
      false,
    );
    const html = mapHtml(state, 'https://speedclub.test/app/map/event-map.js');
    expect(html).toContain(`integrity="${MAPLIBRE_SCRIPT.integrity}"`);
    expect(html).not.toContain('</script><b>');
  });
});
