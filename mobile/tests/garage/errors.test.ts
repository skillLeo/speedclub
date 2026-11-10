/** What a failed save says, in plain words (BH-02, BH-03, BH-09, BH-12). */
import { ApiError, networkError, toApiError } from '@/api/client';
import { isKeyReused, saveErrorMessage } from '@/features/garage/errors';
import { describeUploadError } from '@/features/garage/uploadDriver';
import i18n from '@/i18n';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-1') }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const de = i18n.getFixedT('de', 'garage');
const en = i18n.getFixedT('en', 'garage');

const answer = (status: number, body: object, headers: Record<string, string> = {}) => toApiError({ status, headers: new Headers(headers) }, body);
const SERVER_REUSED = 'Das wurde schon einmal mit anderen Angaben abgeschickt. Lade neu und schau nach, was gespeichert ist.';
const reused = answer(409, { message: SERVER_REUSED, code: 'idempotency_key_reused', errors: {} });
const inFlight = answer(409, { message: 'Diese Anfrage läuft noch. Warte kurz und versuch es noch einmal.', code: 'conflict', errors: {} }, { 'Retry-After': '5' });

describe('saveErrorMessage', () => {
  it('names the reason of a 422 that no field can show, from the real body', () => {
    const limit = 'Du hast schon 20 Fahrzeuge in deiner Garage. Lösche eins, bevor du ein neues anlegst.';
    expect(saveErrorMessage(de, answer(422, { message: limit, code: 'validation_failed', errors: { vehicle: [limit] } }))).toBe(limit);
  });

  it('takes the reason from the errors when the message is the generic one', () => {
    const limit = 'Du hast schon 200 Modifikationen an diesem Fahrzeug.';
    expect(saveErrorMessage(de, answer(422, { message: 'Bitte prüfe deine Eingaben.', code: 'validation_failed', errors: { modification: [limit] } }))).toBe(limit);
    expect(saveErrorMessage(de, answer(422, { message: 'Bitte prüfe deine Eingaben.', code: 'validation_failed', errors: {} }))).toBe('Bitte prüfe deine Eingaben.');
  });

  it('never shows jargon for a reused key, and tells it from the other 409s', () => {
    expect(isKeyReused(reused)).toBe(true);
    expect(isKeyReused(inFlight)).toBe(false);
    expect(saveErrorMessage(de, reused)).toBe('Das wurde schon einmal mit anderen Angaben abgeschickt. Schau nach, was gespeichert ist.');
    expect(saveErrorMessage(en, reused)).toBe('This was already sent once with different details. Check what was saved.');
    expect(saveErrorMessage(de, reused)).not.toMatch(/Idempotency/);
  });

  it('asks a 409 in flight to wait, as the server does', () => {
    expect(saveErrorMessage(de, inFlight)).toBe('Diese Anfrage läuft noch. Warte kurz und versuch es noch einmal.');
    expect(saveErrorMessage(de, answer(409, { message: 'Das steht im Konflikt.', code: 'conflict', errors: {} }))).toBe('Das steht im Konflikt.');
  });

  it('does not claim a creating call failed when its answer got lost', () => {
    const lost = networkError();
    expect(saveErrorMessage(de, lost)).toBe('Keine Verbindung. Deine Änderungen sind noch nicht gespeichert.');
    expect(saveErrorMessage(de, lost, { creating: true })).toBe('Keine Antwort vom Server. Vielleicht kam es trotzdem an. Versuch es ruhig noch einmal, doppelt gespeichert wird nichts.');
    expect(saveErrorMessage(en, lost, { creating: true })).toBe('No answer from the server. It may have arrived anyway. Go ahead and try again – nothing will be saved twice.');
    expect(saveErrorMessage(de, lost, { creating: true })).not.toMatch(/nicht gespeichert/);
  });

  it('keeps the plain default for what is not an ApiError', () => {
    expect(saveErrorMessage(de, new Error('boom'))).toBe('Speichern hat nicht geklappt. Versuche es noch einmal.');
    expect(saveErrorMessage(de, new ApiError({ kind: 'server', status: 500, code: 'server', message: 'x' }))).toBe('Speichern hat nicht geklappt. Versuche es noch einmal.');
  });
});

describe('describeUploadError', () => {
  it('says a reused key in plain words, and that the same key can never pass', async () => {
    await i18n.changeLanguage('de');
    expect(describeUploadError(reused)).toEqual({
      message: 'Beim Hochladen ist etwas durcheinandergeraten. Entferne das Foto und wähle es neu aus.',
      retryable: false,
      retryAfter: null,
      network: false,
    });
  });

  it('keeps waiting on a 409 in flight', async () => {
    await i18n.changeLanguage('de');
    expect(describeUploadError(inFlight)).toMatchObject({ retryable: true, retryAfter: 5 });
  });
});
