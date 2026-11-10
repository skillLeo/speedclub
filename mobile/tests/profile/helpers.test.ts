import { Share } from 'react-native';

import type { MediaData, VehicleCardData } from '@/api/queries/profile';
import { photoFields, profileVehicles, specChips, variantUrl, vehicleCardProps } from '@/features/profile/media';
import { editProfileSchema, profilePatch, profileValues, usernameCooldownUntil } from '@/features/profile/schemas';
import { publicProfileUrl, shareLink } from '@/features/profile/share';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

const media = (overrides: Partial<MediaData> = {}): MediaData => ({
  id: 'm1',
  status: 'ready',
  category: 'exterior',
  width: 1440,
  height: 1920,
  blurhash: 'ToGb||x]jY_Nt7ayM{j?ofIUofjs',
  focal_x: 0.54,
  focal_y: 0.66,
  alt: null,
  sort: 1,
  variants: [
    { width: 1080, height: 1440, url: 'https://cdn/1080.webp' },
    { width: 320, height: 427, url: 'https://cdn/320.webp' },
    { width: 640, height: 853, url: 'https://cdn/640.webp' },
  ],
  created_at: null,
  ...overrides,
});

const vehicle = (overrides: Partial<VehicleCardData> = {}): VehicleCardData => ({
  id: 'v1',
  public_id: '5TF974VJ',
  slug: 'nissan-skyline-gt-r-r34-5tf974vj',
  status: 'published',
  visibility: 'public',
  is_main: true,
  eyebrow: 'NISSAN',
  make: 'Nissan',
  model: 'Skyline GT-R',
  generation: 'R34',
  title: 'Skyline GT-R R34',
  full_title: 'Nissan Skyline GT-R R34',
  nickname: null,
  color: 'Bayside Blue',
  model_year: 2002,
  subline_parts: ['2002', '2,6 l R6 Biturbo (RB26DETT)', 'Bayside Blue'],
  spec_strip: [
    { key: 'power', value: '500', unit: 'PS', label: 'PS' },
    { key: 'torque', value: '540', unit: 'Nm', label: 'Nm' },
    { key: 'model_year', value: '2002', unit: null, label: 'Baujahr' },
    { key: 'drivetrain', value: 'AWD', unit: null, label: 'Antrieb' },
  ],
  cover: media(),
  photo_count: 3,
  mod_count: 14,
  published_at: '2026-03-14T18:30:00+00:00',
  updated_at: null,
  wizard: null,
  completeness: null,
  qr: null,
  ...overrides,
});

describe('profile media', () => {
  it('picks the smallest variant that fills the box on this screen', () => {
    expect(variantUrl(media(), 300, 2)).toBe('https://cdn/640.webp');
    expect(variantUrl(media(), 300, 3)).toBe('https://cdn/1080.webp');
    expect(variantUrl(media(), 2000, 3)).toBe('https://cdn/1080.webp');
    expect(variantUrl(media({ variants: [] }), 300, 2)).toBeNull();
    expect(variantUrl(null, 300, 2)).toBeNull();
  });

  it('keeps the focal point and the blurhash', () => {
    expect(photoFields(media(), 320)).toMatchObject({ blurhash: 'ToGb||x]jY_Nt7ayM{j?ofIUofjs', focal: { x: 0.54, y: 0.66 } });
    expect(photoFields(media({ focal_x: null }), 320).focal).toBeNull();
  });

  it('builds the card of §8 from the API card', () => {
    expect(vehicleCardProps(vehicle(), 304)).toMatchObject({
      // A word joiner after the hyphen: "GT-R" never wraps at it (DQ-047).
      title: 'Nissan Skyline GT-\u2060R R34',
      subtitle: '2002 · 2,6 l R6 Biturbo (RB26DETT)',
      specs: ['500 PS', '540 Nm', 'AWD'],
      isMain: true,
    });
  });

  it('leaves out specs that are not entered yet', () => {
    expect(specChips(vehicle({ spec_strip: [{ key: 'power', value: null, unit: 'PS', label: 'PS' }, { key: 'drivetrain', value: 'RWD', unit: null, label: 'Antrieb' }] }))).toEqual(['RWD']);
  });

  it('shows published vehicles only, as the count does', () => {
    const list = [vehicle(), vehicle({ id: 'v2', status: 'draft' }), vehicle({ id: 'v3', status: 'archived' })];
    expect(profileVehicles(list).map((item) => item.id)).toEqual(['v1']);
    expect(profileVehicles(undefined)).toEqual([]);
  });
});

describe('edit profile schema', () => {
  const schema = editProfileSchema('lukas.sc');
  const base = { displayName: 'Lukas Scholz', username: 'lukas.sc', city: 'Stuttgart', bio: '' };

  it('accepts the current values, whatever rules applied when the name was set', () => {
    expect(editProfileSchema('old..name').safeParse({ ...base, username: 'old..name' }).success).toBe(true);
  });

  it('checks a new username with the rules of AUTH-08', () => {
    const result = schema.safeParse({ ...base, username: 'lukas..sc' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('auth:username.reason.consecutive_dots');
  });

  it('limits the lengths of the server', () => {
    const result = schema.safeParse({ ...base, displayName: 'x'.repeat(61), city: 'y'.repeat(101), bio: 'z'.repeat(501) });
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'profile:edit.validation.bioTooLong',
      'profile:edit.validation.cityTooLong',
      'profile:edit.validation.displayNameTooLong',
    ]);
  });

  it('sends only what changed, trimmed, and an emptied field as null', () => {
    expect(profilePatch({ ...base, displayName: '  Lukas  ', city: '', bio: 'Hallo ' }, { displayName: true, city: true })).toEqual({
      display_name: 'Lukas',
      city: null,
    });
    expect(profilePatch(base, {})).toEqual({});
  });

  it('fills the form from the member, empty where nothing is set', () => {
    expect(profileValues({ display_name: null, username: 'nina.neu', city: null, bio: null })).toEqual({
      displayName: '',
      username: 'nina.neu',
      city: '',
      bio: '',
    });
  });

  it('knows the end of the username cooldown only while it lies ahead', () => {
    const now = new Date('2026-11-03T12:00:00Z');
    expect(usernameCooldownUntil({ username_change_available_at: '2026-12-01T00:30:00+01:00' }, now)?.toISOString()).toBe(
      '2026-11-30T23:30:00.000Z',
    );
    expect(usernameCooldownUntil({ username_change_available_at: '2026-10-01T00:00:00Z' }, now)).toBeNull();
    expect(usernameCooldownUntil({ username_change_available_at: null }, now)).toBeNull();
  });
});

describe('sharing the profile', () => {
  it('links to the public page of the member', () => {
    expect(publicProfileUrl('lukas.sc', 'https://speedclub.de/')).toBe('https://speedclub.de/u/lukas.sc');
    expect(publicProfileUrl('lukas.sc', null)).toBeNull();
    expect(publicProfileUrl('', 'https://speedclub.de')).toBeNull();
  });

  it('opens the native share sheet with title and link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await expect(shareLink({ url: 'https://speedclub.de/u/lukas.sc', title: 'Lukas Scholz auf SPEED CLUB' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ message: 'Lukas Scholz auf SPEED CLUB', url: 'https://speedclub.de/u/lukas.sc' });
    share.mockResolvedValue({ action: Share.dismissedAction, activityType: undefined });
    await expect(shareLink({ url: 'https://speedclub.de/u/lukas.sc', title: 'x' })).resolves.toBe('dismissed');
    share.mockRejectedValue(new Error('no sheet'));
    await expect(shareLink({ url: 'https://speedclub.de/u/lukas.sc', title: 'x' })).resolves.toBe('failed');
    share.mockRestore();
  });
});
