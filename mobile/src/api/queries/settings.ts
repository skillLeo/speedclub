/**
 * The member's account settings (05_ARCHITECTURE §8, M2.5): GAR-12 "Besitzer auf der QR-Seite zeigen", SET-07/09/11, and the
 * Me group of M2.5 (security, sessions, export, deletion, help, support). Theme and language sync through api/queries/auth.ts
 * and never pass here. The hooks hand the screens UI shapes; the answers stay typed by the generated schema.
 *
 * Secrets (the TOTP key, recovery codes, passwords) never reach the persisted cache: those mutations run with
 * `networkMode: 'always'`, so they never pause offline and get dehydrated, and are collected right after they settle.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiData, ApiError, withIdempotency } from '@/api/client';
import { isViewAsTab } from '@/api/clientViewAs';
import { meKey, refreshMe, type Me, type MemberSettings } from '@/api/queries/auth';
import { withRecentAuth } from '@/api/queries/recentAuth';
import type { components } from '@/api/schema';
import { setDisplayUnits } from '@/lib/displayUnits';
import { setPowerDisplay } from '@/lib/powerDisplay';
import { useSessionStore } from '@/state/session';

export const memberSettingsKey = ['me', 'settings'] as const;

/** One settings change after the other: a quick double flip must reach the server in the order it was made. */
const SETTINGS_SCOPE = { id: 'me-settings' } as const;

/** A 4xx is an answer: retrying cannot change it. */
const retryUnlessAnswered = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

/** GET me/settings while signed in. */
export function useMemberSettings() {
  const signedIn = useSessionStore((state) => state.status === 'member');
  return useQuery({
    queryKey: memberSettingsKey,
    queryFn: async ({ signal }) => {
      const settings = (await apiData(api.GET('/me/settings', { signal }))).data;
      // The account's display applies on every screen (SET-11, §3.9; M4.13 units).
      setPowerDisplay(settings.power_display);
      setDisplayUnits({ distance: settings.distance_unit, torque: settings.torque_unit, weight: settings.weight_unit });
      return settings;
    },
    enabled: signedIn,
    retry: retryUnlessAnswered,
  });
}

/**
 * `show_owner_on_qr` (ADR-148 a), account-wide: the switch moves at once, goes back when the server refuses or the call
 * fails, and takes the server's answer when it arrives. Allowed under a publishing restriction, since it only hides.
 */
export function useSetShowOwnerOnQr() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: memberSettingsKey,
    scope: SETTINGS_SCOPE,
    mutationFn: async (show: boolean) => (await apiData(api.PATCH('/me/settings', { body: { show_owner_on_qr: show } }))).data,
    onMutate: async (show) => {
      await client.cancelQueries({ queryKey: memberSettingsKey });
      const before = client.getQueryData<MemberSettings>(memberSettingsKey);
      if (before) client.setQueryData<MemberSettings>(memberSettingsKey, { ...before, show_owner_on_qr: show });
      return { before };
    },
    onError: (_error, _show, context) => {
      if (context?.before) client.setQueryData(memberSettingsKey, context.before);
    },
    onSuccess: (settings) => {
      client.setQueryData(memberSettingsKey, settings);
    },
    // After a failure, the last change in line reads the server's value, so two failed flips cannot leave a guess behind.
    onSettled: (_settings, error) => {
      if (error && client.isMutating({ mutationKey: memberSettingsKey }) <= 1) void client.invalidateQueries({ queryKey: memberSettingsKey });
    },
  });
}

export type SettingsPatch = components['schemas']['UpdateSettingsRequest'];
export type NotificationPrefs = MemberSettings['notification_prefs'];

/** A patched home region: null clears it, a complete one replaces it, an incomplete or missing one keeps the current. */
function homeRegion(current: MemberSettings['home_region'], patch: SettingsPatch['home_region']): MemberSettings['home_region'] {
  if (patch === null) return null;
  if (patch && typeof patch.label === 'string' && typeof patch.lat === 'number' && typeof patch.lng === 'number') {
    return { label: patch.label, lat: patch.lat, lng: patch.lng };
  }
  return current;
}

/** The settings after a patch: `notification_prefs` and `maintenance` merge level by level, as the server does under its row lock (M2.2, M4.13). */
export function mergeSettings(settings: MemberSettings, patch: SettingsPatch): MemberSettings {
  const { notification_prefs: prefs, maintenance, home_region: region, ...rest } = patch;
  // M4.13 SET-23: like the server, a part of `maintenance` merges over the rest.
  const next: MemberSettings = { ...settings, ...rest, home_region: homeRegion(settings.home_region, region), maintenance: { ...settings.maintenance, ...maintenance } };
  if (!prefs) return next;
  const current = settings.notification_prefs;
  const types = { ...current.types };
  for (const [type, channels] of Object.entries(prefs.types ?? {}) as [keyof NotificationPrefs['types'], object][]) {
    Object.assign(types, { [type]: { ...current.types[type], ...channels } });
  }
  return {
    ...next,
    notification_prefs: {
      types,
      quiet_hours: { ...current.quiet_hours, ...prefs.quiet_hours },
      message_previews: prefs.message_previews ?? current.message_previews,
      digest_frequency: prefs.digest_frequency ?? current.digest_frequency,
    },
  };
}

/**
 * SET-07, SET-09, SET-11: one switch, radio or time at a time. The value moves at once, goes back when the server refuses or
 * the call fails, and takes the server's answer when it arrives. Theme and language never pass here: they sync through
 * api/queries/auth.ts (§11, ADR-152 f).
 */
export function useUpdateMemberSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: memberSettingsKey,
    scope: SETTINGS_SCOPE,
    mutationFn: async (patch: SettingsPatch) => (await apiData(api.PATCH('/me/settings', { body: patch }))).data,
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: memberSettingsKey });
      const before = client.getQueryData<MemberSettings>(memberSettingsKey);
      if (before) client.setQueryData<MemberSettings>(memberSettingsKey, mergeSettings(before, patch));
      return { before };
    },
    onError: (_error, _patch, context) => {
      if (context?.before) client.setQueryData(memberSettingsKey, context.before);
    },
    onSuccess: (settings) => {
      client.setQueryData(memberSettingsKey, settings);
    },
    onSettled: (_settings, error) => {
      if (error && client.isMutating({ mutationKey: memberSettingsKey }) <= 1) void client.invalidateQueries({ queryKey: memberSettingsKey });
    },
  });
}

// -- M2.5: UI shapes

export type WhoCanMessage = MemberSettings['who_can_message'];
/** SET-07: the privacy fields of `PATCH me/settings` (contract §2). */
export type PrivacyPatch = Pick<SettingsPatch, 'who_can_message' | 'mention_privacy' | 'discoverable' | 'indexable' | 'read_receipts' | 'ai_suggestions'>;
/** M4.11 "Wer darf mich erwähnen" (ADR-436 b). */
export type MentionPrivacy = MemberSettings['mention_privacy'];
export type PrivacyValues = Pick<MemberSettings, 'who_can_message' | 'discoverable' | 'indexable' | 'read_receipts'>;

/** The defaults of 08_LEGAL_COMPLIANCE §1: reachable, findable and indexable (a community), read receipts on. */
export const PRIVACY_DEFAULTS: PrivacyValues = { who_can_message: 'everyone', discoverable: true, indexable: true, read_receipts: true };

/** The privacy values of a settings answer; the defaults while none is loaded. */
export function privacyOf(settings: MemberSettings | undefined): PrivacyValues {
  if (!settings) return PRIVACY_DEFAULTS;
  const { who_can_message, discoverable, indexable, read_receipts } = settings;
  return { who_can_message, discoverable, indexable, read_receipts };
}

type DeviceSessionResource = components['schemas']['DeviceSessionResource'];
type DataExportResource = components['schemas']['DataExportResource'];

export type DeviceSession = {
  id: string;
  kind: DeviceSessionResource['kind'];
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  lastUsedAt: string;
  current: boolean;
  /** M4.7: "26.1" on iOS, "16" on Android; null for a browser. */
  osVersion: string | null;
  /** M4.7: when this install signed in (ISO 8601); null for a browser. */
  signedInAt: string | null;
  /** M4.7: "München", approximate, only with a GeoLite2 database (OA-33); null until then, and then nothing is shown. */
  approxCity: string | null;
};

export type DataExportStatus = DataExportResource['status'];

export type DataExport = {
  id: string;
  status: DataExportStatus;
  requestedAt: string | null;
  readyAt: string | null;
  expiresAt: string | null;
  bytes: number | null;
  /** The signed link of the mail, while the ZIP can be downloaded (no session needed). */
  downloadUrl: string | null;
};

export type TwoFactorSetup = { secret: string; otpauthUrl: string; qrSvg: string };

export type HelpArticleSummary = { key: string; title: string };
export type HelpArticle = HelpArticleSummary & { bodyMd: string };

export const SUPPORT_CATEGORIES = ['account', 'vehicle', 'qr', 'messaging', 'safety', 'other'] as const satisfies readonly components['schemas']['SupportCategory'][];
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** `code`: with two-factor on, the current code from the app or a recovery code (SEC-P2-07, ADR-221). */
export type ChangeEmailInput = { email: string; password: string; code?: string };
export type ChangePasswordInput = { currentPassword: string; password: string; revokeOtherSessions: boolean; code?: string };
export type ReauthInput = { password: string; code?: string };
export type SupportTicketInput = { category: SupportCategory; subject: string; message: string };

const toDeviceSession = (row: DeviceSessionResource): DeviceSession => ({
  id: row.id,
  kind: row.kind,
  deviceName: row.device_name,
  platform: row.platform,
  appVersion: row.app_version,
  lastUsedAt: row.last_used_at,
  current: row.current,
  osVersion: row.os_version,
  signedInAt: row.signed_in_at,
  approxCity: row.approx_city,
});

const toDataExport = (row: DataExportResource): DataExport => ({
  id: row.id,
  status: row.status,
  requestedAt: row.requested_at,
  readyAt: row.ready_at,
  expiresAt: row.expires_at,
  bytes: row.bytes,
  downloadUrl: row.download_url,
});

/**
 * The ten recovery codes. The export types `recovery_codes` as one string, while the server sends the array of ten (handover §2);
 * both readings give the list, so a fix of the export changes nothing here.
 */
export function recoveryCodesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((code): code is string => typeof code === 'string' && code !== '');
  return typeof value === 'string' && value ? value.split(/[\s,]+/).filter(Boolean) : [];
}

const SECRET = { networkMode: 'always', gcTime: 0, retry: false } as const;

export const settingsKeys = {
  sessions: ['me', 'sessions'] as const,
  exports: ['me', 'exports'] as const,
  help: (locale: string) => ['help', locale] as const,
  article: (locale: string, key: string) => ['help', locale, key] as const,
};

function useSignedIn(): boolean {
  return useSessionStore((state) => state.status === 'member');
}

// -- SET-07

/** SET-07: one privacy field at a time, optimistic like the other settings. */
export function useUpdatePrivacy() {
  const update = useUpdateMemberSettings();
  return update;
}

// -- SET-06

/** `GET me/sessions`: this device first, then by last use. No IP and no place. */
export function useDeviceSessions() {
  const enabled = useSignedIn();
  return useQuery({
    queryKey: settingsKeys.sessions,
    queryFn: async ({ signal }) => (await apiData(api.GET('/me/sessions', { signal }))).data.map(toDeviceSession),
    enabled,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

export function useRevokeSession() {
  return useMutation({
    mutationFn: async (id: string) => {
      await apiData(api.DELETE('/me/sessions/{session}', { params: { path: { session: id } } }));
    },
    retry: false,
  });
}

/** `DELETE me/sessions`: every device but this one. M4.6: needs recent authentication, so the reauth sheet may come first. */
export function useRevokeOtherSessions() {
  return useMutation({
    mutationFn: async () => {
      await withRecentAuth(() => apiData(api.DELETE('/me/sessions')));
    },
    retry: false,
  });
}

// -- SET-12

/** `GET me/exports`, newest first. */
export function useDataExports() {
  // ADR-227: a view-as tab never asks; the export carries the member's messages (403 view_as_no_messages).
  const enabled = useSignedIn() && !isViewAsTab();
  return useQuery({
    queryKey: settingsKeys.exports,
    queryFn: async ({ signal }) => (await apiData(api.GET('/me/exports', { signal }))).data.map(toDataExport),
    enabled,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/** `POST me/export {password}`: 202, one per 24 hours (429 with Retry-After). */
export function useRequestExport() {
  return useMutation({
    mutationFn: async ({ password }: ReauthInput) =>
      toDataExport((await apiData(api.POST('/me/export', { body: { password }, ...withIdempotency() }))).data),
    ...SECRET,
  });
}

// -- SET-05

/** `POST me/two-factor {password}`: the key, pending until confirmed. */
export function useStartTwoFactor() {
  return useMutation({
    mutationFn: async (password: string): Promise<TwoFactorSetup> => {
      const { data } = await apiData(api.POST('/me/two-factor', { body: { password } }));
      return { secret: data.secret, otpauthUrl: data.otpauth_url, qrSvg: data.qr_svg };
    },
    ...SECRET,
  });
}

/** `POST me/two-factor/confirm {code}`: the ten recovery codes, shown once. Me learns `two_factor_enabled`. */
export function useConfirmTwoFactor() {
  return useMutation({
    mutationFn: async (code: string) => recoveryCodesOf((await apiData(api.POST('/me/two-factor/confirm', { body: { code } }))).data.recovery_codes),
    ...SECRET,
  });
}

/** `DELETE me/two-factor {password, code}`. */
export function useDisableTwoFactor() {
  return useMutation({
    mutationFn: async (input: Required<ReauthInput>) => {
      // In the body: a password never belongs in a URL or an access log.
      await apiData(api.DELETE('/me/two-factor', { body: input }));
    },
    ...SECRET,
  });
}

/** `POST me/two-factor/recovery-codes {password, code}`: a new set; the old one stops working. */
export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: async (input: Required<ReauthInput>) =>
      recoveryCodesOf((await apiData(api.POST('/me/two-factor/recovery-codes', { body: input }))).data.recovery_codes),
    ...SECRET,
  });
}

// -- SET-03, SET-04, SET-13

/** `POST me/email {email, password}`: 202 and neutral; a code goes to the new address if it can be used. */
export function useRequestEmailChange() {
  return useMutation({
    mutationFn: async (input: ChangeEmailInput) => {
      await apiData(api.POST('/me/email', { body: input }));
    },
    ...SECRET,
  });
}

/** `POST me/email/confirm {code}`: answers Me with the new address, which applies to the signed-in member only (ADR-185 a). */
export function useConfirmEmailChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => (await apiData(api.POST('/me/email/confirm', { body: { code } }))).data,
    onSuccess: (me: Me) => {
      refreshMe(me);
      void client.invalidateQueries({ queryKey: meKey });
    },
    ...SECRET,
  });
}

/** `POST me/password`. This device stays signed in; other browsers always end, other apps on request. */
export function useChangePassword() {
  return useMutation({
    mutationFn: async ({ currentPassword, password, revokeOtherSessions, code }: ChangePasswordInput) => {
      await apiData(
        api.POST('/me/password', {
          body: {
            current_password: currentPassword,
            password,
            password_confirmation: password,
            revoke_other_sessions: revokeOtherSessions,
            ...(code ? { code } : {}),
          },
        }),
      );
    },
    ...SECRET,
  });
}

/** `POST me/delete {password, code?}`: deactivation at once, deletion within 30 days; the server ends this device's session. */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async ({ password, code }: ReauthInput) => {
      await apiData(api.POST('/me/delete', { body: { password, ...(code ? { code } : {}) } }));
    },
    ...SECRET,
  });
}

// -- SET-14, SET-15

/** `GET help` in the app's language (German where an article has no own version). Guests too. */
export function useHelpArticles(locale: string) {
  return useQuery({
    queryKey: settingsKeys.help(locale),
    queryFn: async ({ signal }): Promise<HelpArticleSummary[]> =>
      (await apiData(api.GET('/help', { signal, headers: { 'Accept-Language': locale } }))).data.map(({ key, title }) => ({ key, title })),
    retry: retryUnlessAnswered,
  });
}

/** `GET help/{key}`; 404 for an unknown or unpublished article. */
export function useHelpArticle(locale: string, key: string | null) {
  return useQuery({
    queryKey: settingsKeys.article(locale, key ?? ''),
    queryFn: async ({ signal }): Promise<HelpArticle> => {
      const { data } = await apiData(
        api.GET('/help/{key}', { params: { path: { key: key ?? '' } }, signal, headers: { 'Accept-Language': locale } }),
      );
      return { key: data.key, title: data.title, bodyMd: data.body_md };
    },
    enabled: key !== null,
    retry: retryUnlessAnswered,
  });
}

/** `POST support/tickets`, idempotent; the receipt mail names the reference. */
export function useCreateSupportTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SupportTicketInput) => (await apiData(api.POST('/support/tickets', { body: input, ...withIdempotency() }))).data,
    retry: false,
    // The new request heads "Deine Anfragen" next time it is read.
    onSuccess: () => void client.invalidateQueries({ queryKey: supportKeys.all }),
  });
}

// -- SET-15 requests (M3.4/M3.5): the member's own tickets and their threads; the team's internal notes never come.

export type SupportTicket = components['schemas']['SupportTicketResource'];
export type SupportThread = components['schemas']['SupportTicketThreadResource'];
export type SupportTicketStatus = components['schemas']['SupportTicketStatus'];

/**
 * Keyed by the member (code review M3.3-app SF-7), like the messaging threads: one browser can hold two members one after the other,
 * and a ticket is free text about an account problem.
 */
export const supportKeys = {
  all: ['support'] as const,
  member: (member: string) => ['support', member] as const,
  // Neither key is a prefix of the other: a new reply refreshes the list and must leave the thread it just answered alone.
  list: (member: string) => ['support', member, 'list'] as const,
  thread: (member: string, id: string) => ['support', member, 'thread', id] as const,
};

/** A subject comes as a string; anything else reads as none. */
export function subjectOf(ticket: Pick<SupportTicket, 'subject'>): string | null {
  return typeof ticket.subject === 'string' && ticket.subject.trim() ? ticket.subject.trim() : null;
}

function useMemberId(): string | null {
  return useSessionStore((state) => (state.status === 'member' ? (state.member?.id ?? null) : null));
}

/** `GET support/tickets`: latest activity first, at most 50. Never stored on the device (SF-7). */
export function useSupportTickets() {
  const member = useMemberId();
  return useQuery({
    queryKey: supportKeys.list(member ?? ''),
    queryFn: async ({ signal }) => (await apiData(api.GET('/support/tickets', { signal }))).data,
    enabled: member !== null,
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/** `GET support/tickets/{ticket}`: the thread, oldest first. 404 for a ticket that is not the member's. Never stored on the device. */
export function useSupportThread(id: string) {
  const member = useMemberId();
  return useQuery({
    queryKey: supportKeys.thread(member ?? '', id),
    queryFn: async ({ signal }) => (await apiData(api.GET('/support/tickets/{ticket}', { params: { path: { ticket: id } }, signal }))).data,
    enabled: member !== null && id !== '',
    retry: retryUnlessAnswered,
    meta: { persist: false },
  });
}

/**
 * `POST support/tickets/{ticket}/messages` (ADR-249): the member writes again in their own request. 201 answers the whole thread, which
 * replaces the stored one; the status is then "offen" again, also for a closed request. The key is the caller's, kept across retries of
 * the same text, so a retry after a lost answer never posts twice. Shares the 5-an-hour limit of new requests (429).
 */
export function useReplyToSupportTicket(id: string) {
  const client = useQueryClient();
  const member = useMemberId();
  return useMutation({
    mutationFn: async (input: { message: string; idempotencyKey: string }) =>
      (
        await apiData(
          api.POST('/support/tickets/{ticket}/messages', {
            params: { path: { ticket: id } },
            body: { message: input.message },
            ...withIdempotency(input.idempotencyKey),
          }),
        )
      ).data,
    retry: false,
    onSuccess: (thread) => {
      if (!member) return;
      client.setQueryData<SupportThread>(supportKeys.thread(member, id), thread);
      void client.invalidateQueries({ queryKey: supportKeys.list(member) });
    },
  });
}
