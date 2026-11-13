import '@/features/parts/i18n';

import type { MyBusiness } from '@/api/queries/businesses';
import { countOf, flattenById } from '@/api/queries/parts';
import { buildSlugOf } from '@/features/parts/components/ProposeSheet';
import {
  addressLines,
  buildsLabel,
  businessHero,
  dayLabel,
  distanceLabel,
  FALLBACK_COVER,
  hasHours,
  hoursText,
  impressumRows,
  phoneUrl,
  routeUrl,
  sampleBusiness,
  sampleProduct,
  tagSubject,
  websiteLabel,
  websiteUrl,
} from '@/features/parts/model';
import {
  applyBody,
  businessSchema,
  emptyValues,
  maskTime,
  normalisedWebsite,
  openingHoursBody,
  serverField,
  serverFieldMap,
  stepOf,
  updateBody,
  valuesFrom,
  type BusinessFormValues,
} from '@/features/parts/schemas';
import i18n from '@/i18n';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));

const t = i18n.getFixedT('de', 'parts');
const en = i18n.getFixedT('en', 'parts');

const IMPRESSUM = {
  legal_name: 'Werkstatt Nord GmbH',
  legal_form: 'gmbh' as const,
  legal_form_label: 'GmbH',
  representative: 'Jana Nord',
  street: 'Hafenweg 3',
  postcode: '20095',
  city: 'Hamburg',
  country: 'DE',
  email: 'kontakt@werkstatt-nord.de',
  phone: '+49 40 123456',
  register_court: 'Amtsgericht Hamburg',
  register_number: 'HRB 123456',
  vat_id: null,
  is_sample: false,
};

function business(extra: Partial<MyBusiness> = {}): MyBusiness {
  return {
    id: '01J00000000000000000000001',
    slug: 'werkstatt-nord',
    name: 'Werkstatt Nord',
    kind: 'workshop',
    kind_label: 'Werkstatt',
    city: 'Hamburg',
    subline: 'Werkstatt · Hamburg',
    services: ['Fahrwerk', 'Abgasanlage'],
    logo: null,
    verified: true,
    is_sample: false,
    distance_km: null,
    share_path: '/b/werkstatt-nord',
    cover: null,
    about: 'Fahrwerk und Achsvermessung.',
    opening_hours: [
      { day: 'mon', ranges: [{ opens: '08:00', closes: '12:00' }, { opens: '13:00', closes: '17:30' }], today: true },
      { day: 'tue', ranges: [{ opens: '08:00', closes: '17:30' }], today: false },
      { day: 'sun', ranges: [], today: false },
    ],
    address: { street: 'Hafenweg 3', postcode: '20095', city: 'Hamburg', country: 'DE', lat: 53.55, lng: 10 },
    contact: { phone: '+49 40 123456', email: 'kontakt@werkstatt-nord.de', website: 'https://werkstatt-nord.de', message_username: 'jana.nord' },
    portfolio_count: 3,
    impressum: IMPRESSUM,
    viewer_role: 'owner',
    status: 'verified',
    removed: false,
    status_reason: null,
    submitted_at: null,
    verified_at: null,
    document_note: null,
    identity_locked: true,
    team: [{ username: 'jana.nord', role: 'owner' }],
    pending_requests: 2,
    views_30d: '128',
    ...extra,
  };
}

describe('parts model', () => {
  it('writes opening hours with a lunch break, and a closed day', () => {
    expect(hoursText({ ranges: [{ opens: '08:00', closes: '12:00' }, { opens: '13:00', closes: '17:30' }] }, t)).toBe('08:00–12:00, 13:00–17:30');
    expect(hoursText({ ranges: [] }, t)).toBe('Geschlossen');
    expect(hoursText({ ranges: [] }, en)).toBe('Closed');
    expect(dayLabel('mon', t)).toBe('Montag');
    expect(dayLabel('xyz', t)).toBe('xyz');
    expect(hasHours(business().opening_hours)).toBe(true);
    expect(hasHours([{ day: 'mon', ranges: [], today: true }])).toBe(false);
  });

  it('only opens http(s) websites and callable numbers', () => {
    expect(websiteUrl('werkstatt-nord.de')).toBe('https://werkstatt-nord.de/');
    expect(websiteUrl('javascript:alert(1)')).toBeNull();
    expect(websiteUrl('data:text/html,x')).toBeNull();
    expect(websiteLabel('https://www.werkstatt-nord.de/kontakt')).toBe('werkstatt-nord.de');
    expect(phoneUrl('+49 (40) 123 456')).toBe('tel:+4940123456');
    expect(phoneUrl('—')).toBeNull();
  });

  it('routes to the pin when there is one, else to the address', () => {
    const address = business().address;
    expect(routeUrl(address, 'ios')).toBe('https://maps.apple.com/?daddr=53.55%2C10');
    expect(routeUrl({ ...address, lat: null, lng: null }, 'web')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Hafenweg%203%2C%2020095%20Hamburg%2C%20DE',
    );
    expect(addressLines({ ...address, country: 'AT' }, t)).toEqual(['Hafenweg 3', '20095 Hamburg', 'Österreich']);
  });

  it('lists the § 5 DDG fields in the law’s order and leaves out what is not there', () => {
    const rows = impressumRows(IMPRESSUM, t);
    expect(rows.map((row) => row.key)).toEqual(['name', 'legalForm', 'address', 'representative', 'email', 'phone', 'register']);
    expect(rows.find((row) => row.key === 'register')?.value).toBe('Amtsgericht Hamburg, HRB 123456');
    expect(rows.find((row) => row.key === 'address')?.value).toBe('Hafenweg 3, 20095 Hamburg');
    expect(impressumRows({ ...IMPRESSUM, vat_id: 'DE123456789' }, t).at(-1)).toEqual({ key: 'vatId', label: 'USt-IdNr.', value: 'DE123456789' });
  });

  it('never shows a business without a photo', () => {
    expect(businessHero({ cover: null }, [], 400).source).toBe('fallback');
    expect(businessHero({ cover: null }, [], 400).photo).toBe(FALLBACK_COVER);
  });

  it('counts are real: nothing for zero, plurals for the rest', () => {
    const format = (n: number) => n.toLocaleString('de-DE');
    expect(buildsLabel(0, t, format)).toBeNull();
    expect(buildsLabel(null, t, format)).toBeNull();
    expect(buildsLabel(1, t, format)).toBe('In 1 Build');
    expect(buildsLabel(1204, t, format)).toBe('In 1.204 Builds');
    expect(countOf('14')).toBe(14);
    expect(countOf(undefined)).toBe(0);
    expect(distanceLabel(12, t, (km) => `${km} km`)).toBe('12 km entfernt');
    expect(distanceLabel(null, t, (km) => `${km} km`)).toBeNull();
  });

  it('keeps a cursor page’s repeated row once', () => {
    expect(flattenById([{ data: [{ id: 'a' }, { id: 'b' }], meta: { next_cursor: 'x' } }, { data: [{ id: 'b' }, { id: 'c' }], meta: { next_cursor: null } }])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
  });

  it('samples are obviously fictional and never counted', () => {
    expect(sampleBusiness(t).is_sample).toBe(true);
    expect(sampleBusiness(t).name).toBe('Beispiel-Werkstatt Nord');
    expect(sampleProduct(t).builds).toBeNull();
  });

  it('names a tag by its mod and build', () => {
    expect(tagSubject({ mod: { id: 'm', title: 'KW Variante 3', category: 'suspension' }, vehicle: null }, t)).toBe('KW Variante 3');
    expect(tagSubject({ mod: null, vehicle: null }, t)).toBe('Nicht mehr verfügbar');
  });

  it('reads a build link in any form', () => {
    expect(buildSlugOf('https://speedclub.de/v/bmw-m3-e46-ab12cd34?x=1')).toBe('bmw-m3-e46-ab12cd34');
    expect(buildSlugOf('/v/Nissan-R34-12345678')).toBe('nissan-r34-12345678');
    expect(buildSlugOf('bmw-m3-e46-ab12cd34')).toBe('bmw-m3-e46-ab12cd34');
    expect(buildSlugOf('not a link')).toBeNull();
  });
});

describe('BIZ-02 form', () => {
  const filled = (extra: Partial<BusinessFormValues> = {}): BusinessFormValues => ({
    ...emptyValues(),
    name: 'Werkstatt Nord',
    legalName: 'Werkstatt Nord GmbH',
    representative: 'Jana Nord',
    registerCourt: 'Amtsgericht Hamburg',
    registerNumber: 'HRB 123456',
    street: 'Hafenweg 3',
    postcode: '20095',
    city: 'Hamburg',
    email: 'kontakt@werkstatt-nord.de',
    acceptTerms: true,
    ...extra,
  });
  const issues = (values: BusinessFormValues, creating = true) => {
    const result = businessSchema(creating).safeParse(values);
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
  };

  it('accepts a complete application', () => {
    expect(issues(filled())).toEqual({});
  });

  it('asks for the register entry only where the legal form has one', () => {
    expect(issues(filled({ registerCourt: '', registerNumber: '' }))).toMatchObject({ registerCourt: 'validation.registerRequired', registerNumber: 'validation.registerRequired' });
    expect(issues(filled({ legalForm: 'sole_trader', registerCourt: '', registerNumber: '' }))).toEqual({});
  });

  it('checks times, the lunch break and the declaration', () => {
    const hours = { ...filled().hours, mon: { open: true, opens: '18:00', closes: '09:00', split: false, opens2: '', closes2: '' } };
    expect(issues(filled({ hours }))).toMatchObject({ 'hours.mon.closes': 'validation.closesBeforeOpens' });
    const split = { ...filled().hours, tue: { open: true, opens: '08:00', closes: '12:00', split: true, opens2: '11:00', closes2: '17:00' } };
    expect(issues(filled({ hours: split }))).toMatchObject({ 'hours.tue.opens2': 'validation.secondRange' });
    expect(issues(filled({ acceptTerms: false }))).toMatchObject({ acceptTerms: 'validation.acceptTerms' });
    expect(issues(filled({ acceptTerms: false }), false)).toEqual({});
    expect(issues(filled({ vatId: 'DE12' }))).toEqual({});
    expect(issues(filled({ vatId: '12345' }))).toMatchObject({ vatId: 'validation.vatId' });
    expect(issues(filled({ website: 'not a site' }))).toMatchObject({ website: 'validation.website' });
    expect(issues(filled({ services: ['Fahrwerk', 'fahrwerk'] }))).toMatchObject({ services: expect.stringContaining('validation.service') });
  });

  it('sends the server’s shapes: hours as pairs, https websites, no register for a sole trader', () => {
    const body = applyBody(filled({ website: 'werkstatt-nord.de', legalForm: 'sole_trader', vatId: 'de 123456789' }));
    expect(body.website).toBe('https://werkstatt-nord.de');
    expect(body.register_court).toBeNull();
    expect(body.vat_id).toBe('DE123456789');
    expect(body.accept_terms).toBe(true);
    expect(body.opening_hours).toEqual({ mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']], thu: [['09:00', '18:00']], fri: [['09:00', '18:00']] });
    expect(openingHoursBody({ ...filled().hours, sat: { open: true, opens: '09:00', closes: '12:00', split: true, opens2: '13:00', closes2: '15:00' } }).sat).toEqual([
      ['09:00', '12:00'],
      ['13:00', '15:00'],
    ]);
    expect(maskTime('0930')).toBe('09:30');
    expect(normalisedWebsite('http://x.de')).toBe('https://x.de');
  });

  it('round-trips the stored business and sends only what changed, never a locked field once verified', () => {
    const values = valuesFrom(business());
    expect(values.hours.mon).toEqual({ open: true, opens: '08:00', closes: '12:00', split: true, opens2: '13:00', closes2: '17:30' });
    expect(values.hours.sun.open).toBe(false);
    expect(updateBody(values, values, true)).toEqual({});
    const changed = { ...values, about: 'Neu', name: 'Anderer Name', street: 'Neuer Weg 1' };
    expect(updateBody(changed, values, true)).toEqual({ about: 'Neu' });
    expect(updateBody(changed, values, false)).toEqual({ about: 'Neu', name: 'Anderer Name', street: 'Neuer Weg 1' });
  });

  it('maps a 422 to its field and step', () => {
    expect(serverField('legal_form')).toBe('legalForm');
    expect(serverField('opening_hours.mon.0.1')).toBe('hours.mon.opens');
    expect(serverField('services.2')).toBe('services');
    expect(serverField('unknown')).toBeNull();
    expect(serverFieldMap({ register_number: ['x'], foo: ['y'] })).toEqual({ register_number: 'registerNumber' });
    expect(stepOf('registerNumber')).toBe('impressum');
    expect(stepOf('hours.mon.opens')).toBe('hours');
    expect(stepOf('email')).toBe('contact');
  });
});
