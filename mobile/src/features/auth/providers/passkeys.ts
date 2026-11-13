/**
 * The passkey client (09 §8.2, ADR-409 client part, behind `auth.passkeys`).
 *
 * Member web: the browser's WebAuthn API (`navigator.credentials`) directly — no library: the server sends WebAuthn L3 JSON options
 * and takes L3 JSON credentials, which is exactly what `PublicKeyCredential.parse*OptionsFromJSON` / `toJSON()` do; older browsers
 * get the same conversion by hand below. Conditional mediation fills the AUTH-12 e-mail field (`autocomplete="username webauthn"`).
 *
 * Native: no passkey module is installed in this build (`react-native-passkeys` is the candidate, ADR-409). Until the lead installs
 * it, `passkeySupport()` reports unavailable on iOS and Android and every passkey entry stays hidden there.
 */
import { isWeb } from '@/lib/platform';
import type { PasskeyCredentialJSON } from '@/api/queries/passwordless';

export class PasskeyCancelled extends Error {
  constructor() {
    super('passkey_cancelled');
    this.name = 'PasskeyCancelled';
  }
}

type Json = Record<string, unknown>;

type PublicKeyCredentialStatic = {
  parseRequestOptionsFromJSON?: (options: Json) => CredentialRequestOptions['publicKey'];
  parseCreationOptionsFromJSON?: (options: Json) => CredentialCreationOptions['publicKey'];
  isConditionalMediationAvailable?: () => Promise<boolean>;
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
};

function credentialClass(): PublicKeyCredentialStatic | null {
  if (!isWeb || typeof window === 'undefined') return null;
  const value = (window as unknown as { PublicKeyCredential?: PublicKeyCredentialStatic }).PublicKeyCredential;
  return value && typeof navigator !== 'undefined' && navigator.credentials ? value : null;
}

/** Whether this platform can sign in with a passkey at all. */
export function passkeysAvailable(): boolean {
  return credentialClass() !== null;
}

/** Whether the browser can offer passkeys in the e-mail field's autofill. */
export async function conditionalMediationAvailable(): Promise<boolean> {
  const cls = credentialClass();
  try {
    return Boolean(cls?.isConditionalMediationAvailable && (await cls.isConditionalMediationAvailable()));
  } catch {
    return false;
  }
}

/** AUTH-14 shows only where the device itself holds passkeys (Face ID, Touch ID, Windows Hello, fingerprint). */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  const cls = credentialClass();
  try {
    return Boolean(cls?.isUserVerifyingPlatformAuthenticatorAvailable && (await cls.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

// -- base64url

export function base64urlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function bufferToBase64url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The options of the server: an object, or a JSON string as the generated type has it. */
function optionsObject(options: unknown): Json {
  if (typeof options === 'string') return JSON.parse(options) as Json;
  return (options ?? {}) as Json;
}

type Descriptor = { id: string; type: string; transports?: string[] };

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return (list as Descriptor[]).map((item) => ({
    ...item,
    id: base64urlToBuffer(item.id),
    type: 'public-key' as const,
  })) as PublicKeyCredentialDescriptor[];
}

export function requestOptionsFromJSON(json: Json): PublicKeyCredentialRequestOptions {
  const parsed = credentialClass()?.parseRequestOptionsFromJSON?.(json);
  if (parsed) return parsed;
  return {
    ...(json as object),
    challenge: base64urlToBuffer(String(json.challenge)),
    allowCredentials: descriptors(json.allowCredentials),
  } as PublicKeyCredentialRequestOptions;
}

export function creationOptionsFromJSON(json: Json): PublicKeyCredentialCreationOptions {
  const parsed = credentialClass()?.parseCreationOptionsFromJSON?.(json);
  if (parsed) return parsed;
  const user = (json.user ?? {}) as Json;
  return {
    ...(json as object),
    challenge: base64urlToBuffer(String(json.challenge)),
    user: { ...(user as object), id: base64urlToBuffer(String(user.id)) },
    excludeCredentials: descriptors(json.excludeCredentials),
  } as PublicKeyCredentialCreationOptions;
}


/** L3 JSON of the browser's answer. */
export function credentialToJSON(credential: PublicKeyCredential): PasskeyCredentialJSON {
  const serialisable = credential as { toJSON?: () => unknown };
  if (typeof serialisable.toJSON === 'function') {
    try {
      return serialisable.toJSON() as PasskeyCredentialJSON;
    } catch {
      // Some browsers throw for extensions they cannot serialise; the manual path below covers what the server reads.
    }
  }
  const response = credential.response as AuthenticatorResponse & Partial<AuthenticatorAssertionResponse & AuthenticatorAttestationResponse>;
  const out: Json = { clientDataJSON: bufferToBase64url(response.clientDataJSON) };
  if (response.authenticatorData) out.authenticatorData = bufferToBase64url(response.authenticatorData);
  if (response.signature) out.signature = bufferToBase64url(response.signature);
  if (response.userHandle) out.userHandle = bufferToBase64url(response.userHandle);
  if (response.attestationObject) out.attestationObject = bufferToBase64url(response.attestationObject);
  if (typeof response.getTransports === 'function') out.transports = response.getTransports();
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: 'public-key',
    response: out,
    clientExtensionResults: credential.getClientExtensionResults?.() as Json | undefined,
    authenticatorAttachment: (credential as { authenticatorAttachment?: string | null }).authenticatorAttachment ?? null,
  };
}

function isCancel(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

/**
 * The platform's passkey prompt for sign-in or reauth. `conditional`: the e-mail field's autofill instead of a modal; it waits until
 * the member picks one or `signal` aborts it.
 */
export async function getPasskey(
  options: unknown,
  { conditional = false, signal }: { conditional?: boolean; signal?: AbortSignal } = {},
): Promise<PasskeyCredentialJSON> {
  if (!passkeysAvailable()) throw new PasskeyCancelled();
  const publicKey = requestOptionsFromJSON(optionsObject(options));
  try {
    const credential = await navigator.credentials.get({
      publicKey,
      ...(conditional ? { mediation: 'conditional' as CredentialMediationRequirement } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!credential) throw new PasskeyCancelled();
    return credentialToJSON(credential as PublicKeyCredential);
  } catch (error) {
    if (isCancel(error)) throw new PasskeyCancelled();
    throw error;
  }
}

/** The platform's prompt to make a new passkey (SET-19, AUTH-14). */
export async function createPasskey(options: unknown): Promise<PasskeyCredentialJSON> {
  if (!passkeysAvailable()) throw new PasskeyCancelled();
  const publicKey = creationOptionsFromJSON(optionsObject(options));
  try {
    const credential = await navigator.credentials.create({ publicKey });
    if (!credential) throw new PasskeyCancelled();
    return credentialToJSON(credential as PublicKeyCredential);
  } catch (error) {
    if (isCancel(error)) throw new PasskeyCancelled();
    // InvalidStateError: this authenticator already holds a passkey of the account (excludeCredentials).
    throw error;
  }
}

export function isPasskeyCancelled(error: unknown): boolean {
  return error instanceof PasskeyCancelled;
}
