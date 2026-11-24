/**
 * M5.9a: every upload path sends `plate_blur` and, when on, `blur_regions` (contract §1): the garage queue (wizard GAR-03,
 * GAR-07, GAR-10, UPD-01), its driver, the message outbox transport (MSG-02) and the PROF-03 cover. EVT-03 and BIZ-02 build their
 * cover form with the same `appendPlateBlur` after the same review step.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';

import type { UploadedMedia } from '@/api/queries/media';
import { createMessagingAdapter } from '@/api/queries/messaging';
import { createGarageUploadDriver } from '@/features/garage/uploadDriver';
import { usePhotoUploads, uploadQueue } from '@/features/garage/uploads';
import { defaultChoice, type PlateBlurChoice } from '@/features/media/plateBlur/model';
import { ProfileImagesEditor } from '@/features/profile/components/ProfileImagesEditor';
import { setMember } from '@/state/session';
import { createUploadQueue, type UploadDriver } from '@/state/uploads';
import { hydrateThemePreference } from '@/theme';
import { Button } from '@/ui';

import { newQueryClient, renderScreen } from '../garage/harness';
import { partsOf } from './formParts';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `uuid-${Math.random()}`) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const mockUploadPhoto = jest.fn();
jest.mock('@/api/queries/media', () => ({
  ...jest.requireActual('@/api/queries/media'),
  uploadPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
}));

const mockPickPhotos = jest.fn();
jest.mock('@/features/garage/photos', () => ({
  ...jest.requireActual('@/features/garage/photos'),
  pickPhotos: (...args: unknown[]) => mockPickPhotos(...args),
  preparePhoto: jest.fn(async (photo: { uri: string }) => `${photo.uri}.prepared.jpg`),
}));

const mockPickProfilePhoto = jest.fn();
jest.mock('@/features/profile/photos', () => ({
  pickProfilePhoto: (...args: unknown[]) => mockPickProfilePhoto(...args),
  profilePhotoForm: jest.fn(async () => new FormData()),
}));

const mockProfileUpload = jest.fn(async () => ({}));
jest.mock('@/api/queries/profile', () => ({
  ...jest.requireActual('@/api/queries/profile'),
  useUploadProfileImage: () => ({ mutateAsync: mockProfileUpload, isPending: false, progress: null }),
}));

beforeAll(hydrateThemePreference);
beforeEach(() => {
  setMember({ id: '01nina', username: 'nina.neu', displayName: 'Nina', avatarUrl: null, nextStep: null });
  mockUploadPhoto.mockReset();
  mockPickPhotos.mockReset();
  mockPickProfilePhoto.mockReset();
  mockProfileUpload.mockClear();
});

const PICKED = [
  { uri: 'file:///picked/front.jpg', width: 4000, height: 3000 },
  { uri: 'file:///picked/rear.jpg', width: 4000, height: 3000 },
];
const MOVED: PlateBlurChoice = { on: true, regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }] };
const media = (id: string) => ({ id, variants: [] }) as unknown as UploadedMedia;
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe('upload queue', () => {
  function fakeDriver() {
    const upload = jest.fn(async () => media('m1'));
    const driver: UploadDriver = {
      prepare: async (photo) => `${photo.uri}.jpg`,
      upload,
      onUploaded: jest.fn(),
      describe: () => ({ message: 'x', retryable: false, retryAfter: null, network: false }),
      newId: (() => {
        let next = 0;
        return () => `id-${(next += 1)}`;
      })(),
      now: () => 1,
      schedule: jest.fn(),
    };
    return { driver, upload };
  }

  it('keeps each photo\'s choice with its item and hands it to the driver', async () => {
    const { driver, upload } = fakeDriver();
    const queue = createUploadQueue(driver);
    const [first, second] = PICKED;
    if (!first || !second) throw new Error('fixture');
    queue.store.getState().enqueue({ kind: 'vehicle', vehicleId: '01v' }, [
      { ...first, plateBlur: MOVED },
      { ...second, plateBlur: { on: false, regions: [] } },
    ]);
    const items = queue.store.getState().items;
    expect(items[0]?.plateBlur).toEqual(MOVED);
    // The file stays the picked file: the choice is not part of it.
    expect(items[0]?.source).toEqual(first);
    await settle();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map((call: unknown[]) => call[5])).toEqual([MOVED, { on: false, regions: [] }]);
  });

  it('sends nothing extra for an item an older build stored without a choice', async () => {
    const { driver, upload } = fakeDriver();
    const queue = createUploadQueue(driver);
    queue.store.getState().enqueue({ kind: 'vehicle', vehicleId: '01v' }, [PICKED[0] ?? PICKED[1]!]);
    await settle();
    expect((upload.mock.calls[0] as unknown[])[5]).toBeUndefined();
  });
});

describe('garage upload driver', () => {
  it('adds plate_blur and blur_regions to the multipart form', async () => {
    mockUploadPhoto.mockResolvedValue(media('m1'));
    const driver = createGarageUploadDriver();
    await driver.upload({ kind: 'mod', vehicleId: '01v', modId: '01m' }, 'file:///p.jpg', 'key', jest.fn(), new AbortController().signal, defaultChoice());
    const form = mockUploadPhoto.mock.calls[0]?.[1] as FormData;
    expect(partsOf(form)).toMatchObject({ plate_blur: '1', blur_regions: '[{"x":0.32,"y":0.7,"w":0.36,"h":0.12}]' });
    expect(partsOf(form).file).toBeDefined();
  });

  it('sends plate_blur "0" when the member switched it off', async () => {
    mockUploadPhoto.mockResolvedValue(media('m1'));
    const driver = createGarageUploadDriver();
    await driver.upload({ kind: 'update', vehicleId: '01v', updateId: '01u' }, 'file:///p.jpg', 'key', jest.fn(), new AbortController().signal, { on: false, regions: [] });
    const parts = partsOf(mockUploadPhoto.mock.calls[0]?.[1] as FormData);
    expect(parts.plate_blur).toBe('0');
    expect(parts.blur_regions).toBeUndefined();
  });
});

describe('message outbox transport (MSG-02)', () => {
  it('posts the photo with its plate blur fields', async () => {
    const bodies: unknown[] = [];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      bodies.push(init?.body);
      return new Response(JSON.stringify({ data: { id: 'msgmedia1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    const adapter = createMessagingAdapter(newQueryClient());
    const id = await adapter.transport.uploadPhoto('01conv', { uri: 'file:///p.jpg', width: 4, height: 3, plateBlur: MOVED }, new AbortController().signal);
    expect(id).toBe('msgmedia1');
    expect(partsOf(bodies[0] as FormData)).toMatchObject({ plate_blur: '1', blur_regions: '[{"x":0.1,"y":0.2,"w":0.3,"h":0.1}]' });
    fetchMock.mockRestore();
  });
});

describe('usePhotoUploads (wizard GAR-03, GAR-07, GAR-10)', () => {
  function Photos() {
    const uploads = usePhotoUploads({ kind: 'vehicle', vehicleId: '01plate' }, [], 30, 'GAR-07');
    return (
      <>
        <Button label="Fotos" onPress={() => void uploads.add()} testID="add" />
        {uploads.reviewElement}
      </>
    );
  }

  it('opens the plate blur editor after the pick and queues the photos with their choices', async () => {
    mockPickPhotos.mockResolvedValue(PICKED);
    mockUploadPhoto.mockResolvedValue(media('m1'));
    await renderScreen(<Photos />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('add'));
    });
    expect(screen.getByText('Foto 1 von 2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('GAR-07.plateBlur.switch'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('GAR-07.plateBlur.confirmAll'));
    });
    const items = uploadQueue().store.getState().items.filter((item) => item.target.vehicleId === '01plate');
    expect(items.map((item) => item.plateBlur)).toEqual([{ on: false, regions: defaultChoice().regions }, defaultChoice()]);
    await settle();
    const fields = mockUploadPhoto.mock.calls.map((call: unknown[]) => partsOf(call[1] as FormData).plate_blur);
    expect(fields).toEqual(['0', '1']);
  });

  it('queues nothing when the member closes the editor and confirms', async () => {
    mockPickPhotos.mockResolvedValue(PICKED.slice(0, 1));
    await renderScreen(<Photos />);
    const before = uploadQueue().store.getState().items.length;
    await act(async () => {
      await fireEvent.press(screen.getByTestId('add'));
    });
    await fireEvent.press(screen.getByTestId('GAR-07.plateBlur.sheet.scrim'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('GAR-07.plateBlur.discard.confirm'));
    });
    expect(uploadQueue().store.getState().items.length).toBe(before);
  });
});

describe('PROF-03 cover', () => {
  const me = { display_name: 'Nina', username: 'nina.neu', avatar: null, cover: null } as unknown as Parameters<typeof ProfileImagesEditor>[0]['me'];

  it('reviews the cover and sends its plate blur fields; the avatar goes without', async () => {
    mockPickProfilePhoto.mockResolvedValue({ uri: 'file:///cover.jpg', width: 1600, height: 900 });
    await renderScreen(<ProfileImagesEditor me={me} width={360} />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('PROF-03.cover.pick'));
    });
    expect(screen.getByTestId('PROF-03.plateBlur.switch')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('PROF-03.plateBlur.confirm'));
    });
    expect(mockProfileUpload).toHaveBeenCalledTimes(1);
    const cover = (mockProfileUpload.mock.calls[0] as unknown as [{ form: FormData }])[0].form;
    expect(partsOf(cover)).toEqual({ plate_blur: '1', blur_regions: '[{"x":0.32,"y":0.7,"w":0.36,"h":0.12}]' });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('PROF-03.avatar.pick'));
    });
    expect(mockProfileUpload).toHaveBeenCalledTimes(2);
    const avatar = (mockProfileUpload.mock.calls[1] as unknown as [{ form: FormData }])[0].form;
    expect(partsOf(avatar)).toEqual({});
  });
});
