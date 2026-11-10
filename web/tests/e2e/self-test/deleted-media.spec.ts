// The registry of photos a spec deletes on purpose (support/deleted-media.mjs): the page-error fixture lets exactly their 404
// through, as the photo of a build another worker deleted, and nothing else.
import { expect, test } from '../support/fixtures';
import { isDeletedMedia, MEDIA_PATH, noteDeletedMedia } from '../support/deleted-media.mjs';

const ulid = (): string => {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  return Array.from({ length: 26 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

test('a noted photo is known by its id, in either case, and an unnoted one is not', () => {
  const noted = ulid();
  const other = ulid();
  noteDeletedMedia({ photos: [{ id: noted }] });
  expect(isDeletedMedia(noted)).toBe(true);
  expect(isDeletedMedia(noted.toUpperCase())).toBe(true);
  expect(isDeletedMedia(other)).toBe(false);
  expect(isDeletedMedia('../../etc/passwd')).toBe(false);
  expect(() => noteDeletedMedia([{ id: 'not-an-id' }])).toThrow(/not a media id/);
});

test('the media id is read from the variant URL only', () => {
  const id = ulid();
  expect(MEDIA_PATH.exec(`http://localhost:8080/storage/media/${id}/1304d697ec4bdd1e-640.webp`)?.[1]).toBe(id);
  expect(MEDIA_PATH.exec(`http://localhost:8080/api/v1/media/${id}`)).toBeNull();
});

test('the page-error fixture lets the 404 of a noted photo through, and still fails on any other 404', async ({ page, pageErrors }) => {
  const noted = ulid();
  const other = ulid();
  noteDeletedMedia([{ id: noted }]);
  await page.route('**/storage/media/**', (route) => route.fulfill({ status: 404, body: '' }));
  // A page of the server, so the relative paths are its own.
  await page.goto('/app/');
  await page.setContent(`<img src="/storage/media/${noted}/a-640.webp"><img src="/storage/media/${other}/b-640.webp">`);
  await expect.poll(() => pageErrors.length).toBe(1);
  expect(pageErrors[0]).toContain(other);
  // The other 404 is a real error; this test owns it, so it leaves the list empty for the fixture's own check.
  pageErrors.length = 0;
});
