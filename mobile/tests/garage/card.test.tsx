/**
 * DQ-1050 (09 §5 VehicleCard 2.0): the garage card's caption, mini spec and status, and the card itself — 4:5 photo radius 20,
 * the name in display.title, the status on the photo, the QR control beside (never inside) the card's pressable.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';
import type { TFunction } from 'i18next';
import { useWindowDimensions } from 'react-native';

import { cardCaption, cardStats, cardStatus, garageCardProps } from '@/features/garage/card';
import i18n from '@/i18n';
import { hydrateThemePreference, radius } from '@/theme';
import { VehicleCard } from '@/ui/VehicleCard';

import { flat, renderUi } from '../ui/helpers';
import { card } from './fixtures';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 1, fontScale: 1 })),
}));
const dimensions = useWindowDimensions as jest.Mock;

beforeAll(hydrateThemePreference);
beforeEach(() => dimensions.mockReturnValue({ width: 393, height: 852, scale: 1, fontScale: 1 }));

const t = i18n.getFixedT('de', 'garage') as unknown as TFunction<'garage'>;

describe('garage card data', () => {
  it('captions the catalogue parts that are known: "BMW · M3 · G80 · 2021"', () => {
    expect(cardCaption({ make: 'BMW', model: 'M3', generation: 'G80', model_year: 2021 })).toBe('BMW · M3 · G80 · 2021');
    expect(cardCaption({ make: 'BMW', model: null, generation: null, model_year: null })).toBe('BMW');
    expect(cardCaption({ make: null, model: null, generation: null, model_year: null })).toBeUndefined();
  });

  it('takes power, torque and year with values, labels them as data and leaves the drivetrain to the vehicle page', () => {
    const stats = cardStats(
      {
        spec_strip: [
          { key: 'power', value: '500', unit: 'PS', label: 'PS' },
          { key: 'torque', value: null, unit: 'Nm', label: 'Nm' },
          { key: 'model_year', value: '2002', unit: null, label: 'Baujahr' },
          { key: 'drivetrain', value: 'Allrad', unit: null, label: 'Antrieb' },
        ],
      },
      t,
    );
    expect(stats).toEqual([
      { key: 'power', value: '500', unit: 'PS', label: 'Leistung' },
      { key: 'model_year', value: '2002', unit: null, label: 'Baujahr' },
    ]);
  });

  it('names the status: a draft is "Entwurf" whatever its planned visibility', () => {
    expect(cardStatus({ status: 'draft', visibility: 'public' })).toBe('draft');
    expect(cardStatus({ status: 'published', visibility: 'unlisted' })).toBe('unlisted');
    expect(garageCardProps(card({ visibility: 'private' }), 353, t).status).toBe('Privat');
  });
});

describe('VehicleCard garage variant', () => {
  const props = {
    variant: 'garage' as const,
    title: 'Nissan Skyline GT-R R34',
    caption: 'Nissan · Skyline GT-R · R34 · 2002',
    photo: { source: 'https://x/a.webp', blurhash: 'LKO2?U%2Tw=w' },
    stats: [
      { key: 'power', value: '500', unit: 'PS', label: 'Leistung' },
      { key: 'torque', value: '540', unit: 'Nm', label: 'Drehmoment' },
      { key: 'model_year', value: '2002', label: 'Baujahr' },
    ],
    status: 'Öffentlich',
    layoutWidth: 353,
  };

  it('draws the §5 anatomy: 4:5 photo radius 20, display title, caption, mini spec, status on the photo', async () => {
    await renderUi(<VehicleCard {...props} isMain testID="c" />);
    expect(flat(screen.getByTestId('c.photo').props.style).borderRadius).toBe(radius.xl);
    expect(flat(screen.getByTestId('c.photo').props.style).aspectRatio).toBeCloseTo(4 / 5);
    // The name binds "GT-R" (keepNameTogether may put a joiner or a non-breaking hyphen there): match around it.
    expect(screen.getByTestId('c.title')).toHaveTextContent(/^Nissan Skyline GT\W{1,2}R R34$/u);
    expect(screen.getByTestId('c.caption')).toHaveTextContent(/^Nissan · Skyline GT\W{1,2}R · R34 · 2002$/u);
    expect(screen.getByTestId('c.spec')).toHaveTextContent(/500.*PS.*Leistung.*540.*Nm.*Drehmoment.*2002.*Baujahr/);
    expect(screen.getByTestId('c.status')).toHaveTextContent('Öffentlich');
    expect(screen.getByTestId('c.badge')).toHaveTextContent('Hauptfahrzeug');
  });

  it('puts the QR control beside the pressable card, so the controls never nest', async () => {
    const onPress = jest.fn();
    const onQr = jest.fn();
    await renderUi(<VehicleCard {...props} onPress={onPress} qr={{ label: 'QR-Code für Skyline', onPress: onQr, testID: 'c.qr' }} testID="c" />);
    await fireEvent.press(screen.getByTestId('c.qr'));
    expect(onQr).toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    // The QR control is not a descendant of the card's link.
    expect(within(screen.getByTestId('c.body')).queryByTestId('c.qr')).toBeNull();
  });
});
