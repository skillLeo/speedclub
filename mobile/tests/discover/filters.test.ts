import { chipLabel, forgetLabelsForTests, rememberLabel, slugWords } from '@/features/discover/chipLabels';
import {
  activeChips,
  activeFilterCount,
  applyInterpretation,
  availableSorts,
  EMPTY_STATE,
  effectiveSort,
  hasCriteria,
  paramsPatch,
  parseSearchParams,
  removeChip,
  resetFilters,
  searchParamsOf,
  setRange,
  setSingle,
  sliderRange,
  toggleValue,
} from '@/features/discover/filters';
import i18n from '@/i18n';
import { formatNumber } from '@/lib/format';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'discover', ...options });
const de = (value: number, options?: { maxFractionDigits?: number }) => formatNumber(value, 'de', options);

describe('the DISC-02 filter model', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });
  beforeEach(() => forgetLabelsForTests());

  it('round-trips every filter through the URL', () => {
    const url = {
      q: 'turbo',
      make: 'bmw',
      model: 'm4',
      generation: 'g82',
      year_min: '2015',
      year_max: '2024',
      power_min: '400',
      power_max: '700',
      drivetrain: 'all,rear',
      gearbox: 'manual',
      fuel: 'petrol',
      wheel_diameter: '20,19',
      wheel_brand: 'bbs',
      suspension_type: 'coilover',
      suspension_brand: 'kw',
      exhaust_brand: 'akrapovic',
      mod_category: 'wheels_tires,exhaust',
      sort: 'power',
      view: 'grid',
    };
    const state = parseSearchParams(url);
    expect(state.filters.wheel_diameter).toEqual(['19', '20']);
    const again = parseSearchParams(searchParamsOf(state));
    expect(again).toEqual(state);
    expect(searchParamsOf(state)).toMatchObject({ make: 'bmw', wheel_diameter: '19,20', view: 'grid', sort: 'power' });
  });

  it('drops what a hand-edited URL cannot mean, and never keeps a model without its make', () => {
    const state = parseSearchParams({
      model: 'm4',
      generation: 'g82',
      power_min: '9999',
      power_max: 'abc',
      wheel_diameter: '19.3,30,18.5',
      wheel_brand: 'BBS,<script>',
      sort: 'likes',
      view: 'mosaic',
    });
    expect(state.filters.model).toBeNull();
    expect(state.filters.generation).toBeNull();
    expect(state.filters.power).toEqual({ min: null, max: null });
    expect(state.filters.wheel_diameter).toEqual(['18.5']);
    expect(state.filters.wheel_brand).toEqual(['bbs']);
    expect(state.sort).toBeNull();
    expect(state.view).toBeNull();
  });

  it('accepts array params from a router, one comma-separated value, and the API’s bracketed form', () => {
    expect(parseSearchParams({ drivetrain: ['all', 'rear'] }).filters.drivetrain).toEqual(['all', 'rear']);
    const linked = parseSearchParams({ make: 'bmw', 'wheel_diameter[]': ['19', '20'] });
    expect(linked.filters.wheel_diameter).toEqual(['19', '20']);
    expect(paramsPatch(linked)).toMatchObject({ wheel_diameter: '19,20', 'wheel_diameter[]': undefined });
  });

  it('clears removed keys in the patch it hands to setParams', () => {
    const patch = paramsPatch(EMPTY_STATE);
    expect(Object.keys(patch)).toEqual(expect.arrayContaining(['make', 'power_min', 'wheel_diameter', 'sort', 'view', 'q']));
    expect(Object.values(patch).every((value) => value === undefined)).toBe(true);
  });

  it('keeps a range exact and in order; only the slider snaps, and its full span is no filter', () => {
    expect(setRange(EMPTY_STATE.filters, 'power', { min: 704, max: 403 }).power).toEqual({ min: 403, max: 704 });
    expect(setRange(EMPTY_STATE.filters, 'power', { min: 50, max: 333 }).power).toEqual({ min: 50, max: 333 });
    expect(parseSearchParams({ power_min: '333' }).filters.power).toEqual({ min: 333, max: null });
    expect(sliderRange([54, 1500])).toEqual({ min: null, max: null });
    expect(sliderRange([333, 704])).toEqual({ min: 330, max: 700 });
  });

  it('drops an enum value the API does not know, as an old link may carry', () => {
    expect(parseSearchParams({ drivetrain: 'awd,rear', fuel: 'diesel,steam' }).filters).toMatchObject({ drivetrain: ['rear'], fuel: ['diesel'] });
  });

  it('removes a chip, and a make takes its model and generation with it', () => {
    const state = parseSearchParams({ make: 'bmw', model: 'm4', generation: 'g82', wheel_diameter: '19,20', power_min: '500' });
    expect(activeChips(state.filters).map((chip) => chip.id)).toEqual([
      'make:bmw',
      'model:m4',
      'generation:g82',
      'power:500-',
      'wheel_diameter:19',
      'wheel_diameter:20',
    ]);
    expect(activeFilterCount(state.filters)).toBe(6);

    const withoutWheel = removeChip(state.filters, { field: 'wheel_diameter', value: '19' });
    expect(withoutWheel.wheel_diameter).toEqual(['20']);
    const withoutPower = removeChip(state.filters, { field: 'power', value: '500-' });
    expect(withoutPower.power).toEqual({ min: null, max: null });
    const withoutModel = removeChip(state.filters, { field: 'model', value: 'm4' });
    expect([withoutModel.make, withoutModel.model, withoutModel.generation]).toEqual(['bmw', null, null]);
    const withoutMake = removeChip(state.filters, { field: 'make', value: 'bmw' });
    expect([withoutMake.make, withoutMake.model, withoutMake.generation]).toEqual([null, null, null]);
  });

  it('a new make clears the model, and toggling a value twice leaves nothing', () => {
    const state = parseSearchParams({ make: 'bmw', model: 'm4' });
    expect(setSingle(state.filters, 'make', 'audi')).toMatchObject({ make: 'audi', model: null });
    const once = toggleValue(state.filters, 'drivetrain', 'awd');
    expect(toggleValue(once, 'drivetrain', 'awd').drivetrain).toEqual([]);
  });

  it('"Zurücksetzen" turns every filter off and keeps the text, sort and view', () => {
    const state = parseSearchParams({ q: 'm4', make: 'bmw', fuel: 'petrol', sort: 'power', view: 'grid' });
    const reset = resetFilters(state);
    expect(activeFilterCount(reset.filters)).toBe(0);
    expect(reset).toMatchObject({ q: 'm4', sort: 'power', view: 'grid' });
  });

  it('searches with the sort=newest entry from Home alone, and defaults the sort by the text', () => {
    const newest = parseSearchParams({ sort: 'newest' });
    expect(hasCriteria(newest)).toBe(true);
    expect(hasCriteria(EMPTY_STATE)).toBe(false);
    expect(effectiveSort({ q: 'm4', sort: null })).toBe('relevance');
    expect(effectiveSort({ q: '', sort: null })).toBe('newest');
    expect(effectiveSort({ q: '', sort: 'relevance' })).toBe('newest');
    expect(availableSorts('')).not.toContain('relevance');
  });

});

describe('query understanding', () => {
  it('turns what the interpreter understood into visible filters and searches with the rest', () => {
    const before = parseSearchParams({ q: 'bmw m4 19 zoll turbo', fuel: 'petrol' });
    const after = applyInterpretation(before, { make: 'bmw', model: 'm4', wheel_diameter: 19, power_min: null }, 'turbo');
    expect(after.q).toBe('turbo');
    expect(activeChips(after.filters).map((chip) => chip.id)).toEqual(['make:bmw', 'model:m4', 'fuel:petrol', 'wheel_diameter:19']);
  });

  it('applies a year as a range of that year', () => {
    const after = applyInterpretation(EMPTY_STATE, { year_min: 2002, year_max: 2002 }, '');
    expect(after.filters.year).toEqual({ min: 2002, max: 2002 });
  });
});

describe('chip labels', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  it('writes sizes, power and years in the German notation', () => {
    expect(chipLabel({ field: 'wheel_diameter', value: '19.5' }, t, de)).toBe('19,5″');
    expect(chipLabel({ field: 'power', value: '500-' }, t, de)).toBe('ab 500 PS');
    expect(chipLabel({ field: 'power', value: '-1000' }, t, de)).toBe('bis 1.000 PS');
    expect(chipLabel({ field: 'power', value: '400-700' }, t, de)).toBe('400–700 PS');
    expect(chipLabel({ field: 'year', value: '2018-2018' }, t, de)).toBe('Baujahr 2018');
    expect(chipLabel({ field: 'year', value: '2015-2020' }, t, de)).toBe('Baujahr 2015–2020');
    expect(chipLabel({ field: 'year', value: '2018-' }, t, de)).toBe('ab Baujahr 2018');
    expect(chipLabel({ field: 'year', value: '-2018' }, t, de)).toBe('bis Baujahr 2018');
  });

  it('writes the year chips in English with the word', async () => {
    const en = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('en', 'discover')(key, options);
    expect(chipLabel({ field: 'year', value: '2015-2020' }, en, de)).toBe('Year 2015–2020');
    expect(chipLabel({ field: 'year', value: '2018-' }, en, de)).toBe('2018 or newer');
    expect(chipLabel({ field: 'year', value: '-2018' }, en, de)).toBe('2018 or older');
  });

  it('uses the catalogue name once it is known, the slug’s words before', () => {
    expect(chipLabel({ field: 'make', value: 'mercedes-benz' }, t, de)).toBe('Mercedes Benz');
    rememberLabel('make', 'mercedes-benz', 'Mercedes-Benz');
    expect(chipLabel({ field: 'make', value: 'mercedes-benz' }, t, de)).toBe('Mercedes-Benz');
    expect(slugWords('g82')).toBe('G82');
  });
});
