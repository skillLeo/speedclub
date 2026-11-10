import {
  basicsPatch,
  basicsValues,
  completenessBar,
  completeOrder,
  deltaForKey,
  laterStep,
  missingForPublish,
  moveByKey,
  moveItem,
  nextStep,
  powerCounterpart,
  previousStep,
  resumeStep,
  slotAt,
  slotPosition,
  specsRequest,
  specsValues,
  splitGarage,
  stepAt,
  stepFor,
  stepNumber,
  WIZARD_STEPS,
} from '@/features/garage/model';

import { card, draftCard, media, vehicle } from './fixtures';

describe('GAR-01 list', () => {
  it('keeps the server order for vehicles and puts drafts in their own section', () => {
    const main = card();
    const second = card({ id: '01second', is_main: false });
    const draft = draftCard();
    const { vehicles, drafts } = splitGarage([main, draft, second]);
    expect(vehicles.map((entry) => entry.id)).toEqual([main.id, second.id]);
    expect(drafts.map((entry) => entry.id)).toEqual([draft.id]);
    expect(splitGarage(undefined)).toEqual({ vehicles: [], drafts: [] });
  });

  it('turns the completeness into the line and the 2-px bar of FS-4', () => {
    expect(completenessBar(card())).toEqual({ label: 'Build zu 70 % vollständig', value: 0.7 });
    expect(completenessBar(card({ completeness: null }))).toBeUndefined();
    expect(completenessBar(card({ completeness: { percent: 140, is_complete: true, line: 'x', hint: null, missing: [] } }))?.value).toBe(1);
  });
});

describe('reorder', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an entry and clamps targets outside the list', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 1, 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveItem(list, 7, 0)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sends every photo exactly once, also one that arrived or went while the member sorted (GAR-07)', () => {
    expect(completeOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    // An upload finished during sorting: it joins at the end instead of making the server refuse the whole order.
    expect(completeOrder(['c', 'a', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd']);
    // A photo deleted elsewhere meanwhile is left out; a repeated id is sent once.
    expect(completeOrder(['c', 'a', 'a', 'b'], ['a', 'c'])).toEqual(['c', 'a']);
  });

  it('moves one place by keyboard and stops at both ends', () => {
    expect(moveByKey(list, (item) => item, 'b', 1)).toEqual({ list: ['a', 'c', 'b', 'd'], index: 2 });
    expect(moveByKey(list, (item) => item, 'b', -1)).toEqual({ list: ['b', 'a', 'c', 'd'], index: 0 });
    expect(moveByKey(list, (item) => item, 'a', -1)).toBeNull();
    expect(moveByKey(list, (item) => item, 'd', 1)).toBeNull();
    expect(moveByKey(list, (item) => item, 'x', 1)).toBeNull();
  });

  it('maps arrow keys to moves: up and down in a list, all four in a grid', () => {
    expect(deltaForKey('ArrowUp', 1)).toBe(-1);
    expect(deltaForKey('ArrowDown', 1)).toBe(1);
    expect(deltaForKey('ArrowLeft', 1)).toBeNull();
    expect(deltaForKey('ArrowUp', 3)).toBe(-3);
    expect(deltaForKey('ArrowRight', 3)).toBe(1);
    expect(deltaForKey('ArrowLeft', 3)).toBe(-1);
    expect(deltaForKey('Enter', 3)).toBeNull();
    expect(deltaForKey(undefined, 1)).toBeNull();
  });

  it('finds the slot under a dragged cell by its nearest centre', () => {
    const list1 = { width: 300, height: 72, gap: 0, columns: 1 };
    expect(slotAt(0, 0, list1, 5)).toBe(0);
    expect(slotAt(0, 35, list1, 5)).toBe(0);
    expect(slotAt(0, 37, list1, 5)).toBe(1);
    expect(slotAt(0, 72 * 4, list1, 5)).toBe(4);
    expect(slotAt(0, 9999, list1, 5)).toBe(4);
    expect(slotAt(0, -500, list1, 5)).toBe(0);
    const grid = { width: 100, height: 75, gap: 8, columns: 3 };
    expect(slotPosition(4, grid)).toEqual({ x: 108, y: 83 });
    expect(slotAt(108, 83, grid, 7)).toBe(4);
    expect(slotAt(260, 0, grid, 7)).toBe(2);
    expect(slotAt(500, 500, grid, 7)).toBe(6);
  });
});

describe('wizard', () => {
  it('numbers the four steps as the API stores them', () => {
    expect(WIZARD_STEPS).toEqual(['vehicle', 'specs', 'photos', 'review']);
    expect(WIZARD_STEPS.map(stepNumber)).toEqual([1, 2, 3, 4]);
    expect(stepAt(3)).toBe('photos');
    expect(stepAt(0)).toBe('vehicle');
    expect(stepAt(9)).toBe('review');
    expect(nextStep('specs')).toBe('photos');
    expect(nextStep('review')).toBeNull();
    expect(previousStep('specs')).toBe('vehicle');
    expect(previousStep('vehicle')).toBeNull();
  });

  it('resumes a draft at its saved step and never moves the mark backwards', () => {
    expect(resumeStep(draftCard())).toBe('specs');
    expect(resumeStep(draftCard({ wizard: null }))).toBe('vehicle');
    expect(laterStep(3, 'specs')).toBe(3);
    expect(laterStep(1, 'photos')).toBe(3);
    expect(laterStep(undefined, 'vehicle')).toBe(1);
  });

  it('lists what publishing still needs: make, model, year and one finished photo', () => {
    expect(missingForPublish(vehicle())).toEqual([]);
    expect(missingForPublish(vehicle({ make: ' ', model: '', model_year: null, photos: [media('p', { status: 'processing' })] }))).toEqual([
      'make',
      'model',
      'model_year',
      'photo',
    ]);
    expect(stepFor('photo')).toBe('photos');
    expect(stepFor('model_year')).toBe('vehicle');
  });
});

describe('basics', () => {
  it('reads catalogue ids and free text back into the form', () => {
    expect(basicsValues(vehicle())).toMatchObject({ make: { id: 34, name: 'Nissan' }, model: { id: 254, name: 'Skyline GT-R' }, year: '2002' });
    const free = basicsValues(vehicle({ make_id: null, make_text: 'Lada', make: 'Lada', model_id: null, model_text: 'Niva', model: 'Niva', generation_id: null }));
    expect(free.make).toEqual({ id: null, name: 'Lada' });
    expect(free.generation).toBeNull();
    expect(basicsValues(undefined).make).toBeNull();
  });

  it('sends an id or its free text, never both, and the model along with a new make', () => {
    // A new make clears model and generation in the form (VehicleBasicsFields), as the server does.
    const values = { ...basicsValues(vehicle()), make: { id: 1, name: 'BMW' }, model: { id: null, name: 'M3 CS' }, generation: null };
    expect(basicsPatch(values, { make: true })).toEqual({ make_id: 1, model_text: 'M3 CS', generation_id: null });
    expect(basicsPatch(values, { year: true, nickname: true })).toEqual({ model_year: 2002, nickname: null });
    expect(basicsPatch({ ...values, description: '  ' }, { description: true })).toEqual({ description: null });
    expect(basicsPatch(basicsValues(undefined), 'all')).toMatchObject({ make_id: null, model_id: null, model_year: null });
  });
});

describe('specs', () => {
  it('round-trips the stored values through the form', () => {
    const values = specsValues(vehicle().specs, 'de');
    expect(values).toMatchObject({ engineCode: 'RB26DETT', displacement: '2568', powerValue: '368,5', powerUnit: 'kw', powerSource: 'measured', drivetrain: 'all' });
    expect(specsRequest(values, 'de')).toEqual({
      engine_code: 'RB26DETT',
      engine_text: '2,6 l R6 Biturbo',
      displacement_cc: 2568,
      fuel: 'petrol',
      aspiration: 'biturbo',
      power_value: 368.5,
      power_unit: 'kw',
      power_source: 'measured',
      torque_nm: 540,
      torque_source: 'claimed',
      drivetrain: 'all',
      gearbox: 'manual',
    });
  });

  it('clears what is empty, and a power without a value takes no unit or source', () => {
    const empty = specsValues(undefined, 'de');
    expect(empty.powerUnit).toBe('ps');
    expect(specsRequest({ ...empty, powerSource: 'factory' }, 'de')).toMatchObject({ power_value: null, power_unit: null, power_source: null, torque_nm: null });
    expect(specsRequest({ ...empty, displacement: '1.998' }, 'de').displacement_cc).toBe(1998);
  });

  it("shows FS-5's live helper in the other unit", () => {
    // A no-break space keeps the unit with its number when the helper wraps.
    const nbsp = String.fromCharCode(0xa0);
    expect(powerCounterpart('500', 'ps', 'de')).toBe(`≈ 368${nbsp}kW`);
    expect(powerCounterpart('368', 'kw', 'de')).toBe(`≈ 500${nbsp}PS`);
    expect(powerCounterpart('493', 'hp', 'de')).toBe(`≈ 500${nbsp}PS`);
    expect(powerCounterpart('', 'ps', 'de')).toBeNull();
    expect(powerCounterpart('abc', 'ps', 'de')).toBeNull();
  });
});

describe('a draft without a name (BH-00)', () => {
  it('lists the missing model or make instead of throwing on null', () => {
    expect(missingForPublish(vehicle({ model: null, model_id: null }))).toEqual(['model']);
    expect(missingForPublish(vehicle({ make: null, make_id: null, model: null, model_id: null }))).toEqual(['make', 'model']);
    expect(missingForPublish(vehicle({ make: '  ' }))).toEqual(['make']);
  });

  it('leaves the pickers empty, with no name to show', () => {
    const values = basicsValues(vehicle({ make: 'Nissan', make_id: 34, model: null, model_id: null, model_text: null, generation: null, generation_id: null }));
    expect(values.make).toEqual({ id: 34, name: 'Nissan' });
    expect(values.model).toBeNull();
    expect(basicsValues(vehicle({ make: null, make_id: 34 })).make).toBeNull();
    expect(basicsValues(vehicle({ make: null, make_id: null, make_text: 'Eigenbau' })).make).toEqual({ id: null, name: 'Eigenbau' });
  });
});

describe('a stored power goes back out as it came in (BH-15)', () => {
  it.each([
    [110.25, 'de', '110,25'],
    [73.55, 'de', '73,55'],
    [1500.55, 'de', '1.500,55'],
    [0.04, 'de', '0,04'],
    [110.25, 'en', '110.25'],
    [1500.55, 'en', '1,500.55'],
  ] as const)('%d in %s shows as %s and is sent unchanged', (power, locale, text) => {
    const specs = { ...vehicle().specs, power_value: power };
    const values = specsValues(specs, locale);
    expect(values.powerValue).toBe(text);
    expect(specsRequest(values, locale).power_value).toBe(power);
  });
});
