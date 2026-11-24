/**
 * R4-2.3 Crews, the pure rules: the viewer's action by `viewer.state`, who may do what to a member, the form's name rules (contract
 * §4), the filters in the address (never a size sort), the PATCH body, the error texts of contract §8, the `crew` notification row
 * and the Entdecken segment behind the flag.
 */
import { ApiError } from '@/api/client';
import { crewQueryOf, type Crew } from '@/api/queries/crews';
import type { AppNotification } from '@/api/queries/notifications';
import {
  byRole,
  crewAction,
  crewErrorText,
  crewFiltersFromParams,
  crewFormSchema,
  crewSubline,
  isReservedCrewName,
  memberControls,
  sampleCrew,
  updateBody,
} from '@/features/crews/model';
import { visibleSegments } from '@/features/discover/segments';
import { notificationCategory, notificationIcon, notificationTarget, notificationText } from '@/features/home/notifications';
import i18n from '@/i18n';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));

const can = (extra: Partial<NonNullable<Crew['viewer']>['can']> = {}) => ({
  edit: false,
  invite: false,
  approve: false,
  manage_members: false,
  hand_over: false,
  delete: false,
  join: false,
  request: false,
  leave: false,
  ...extra,
});

function crew(viewer: Crew['viewer'], extra: Partial<Crew> = {}): Pick<Crew, 'viewer' | 'join_mode' | 'status'> {
  return { viewer, join_mode: 'open', status: 'active', ...extra };
}

const viewer = (state: 'member' | 'requested' | 'invited' | 'none', role: 'founder' | 'admin' | 'member' | null = null, extra = {}) => ({
  role,
  state,
  invite_id: state === 'invited' ? '01JINVITE' : null,
  request_id: state === 'requested' ? '01JREQUEST' : null,
  can: can(extra),
});

const t = i18n.getFixedT('de', 'discover', 'crews') as unknown as (key: string, options?: Record<string, unknown>) => string;

describe('CREW-01 the viewer’s action', () => {
  it('follows viewer.state and can', () => {
    expect(crewAction(crew(null))).toBe('signIn');
    expect(crewAction(crew(null, { join_mode: 'invite' }))).toBe('inviteOnly');
    expect(crewAction(crew(viewer('none', null, { join: true })))).toBe('join');
    expect(crewAction(crew(viewer('none', null, { request: true }), { join_mode: 'request' }))).toBe('request');
    expect(crewAction(crew(viewer('none'), { join_mode: 'invite' }))).toBe('inviteOnly');
    expect(crewAction(crew(viewer('requested')))).toBe('withdraw');
    expect(crewAction(crew(viewer('invited', null, { join: true }), { join_mode: 'invite' }))).toBe('accept');
    expect(crewAction(crew(viewer('member', 'member', { leave: true })))).toBe('leave');
    expect(crewAction(crew(viewer('member', 'admin', { leave: true, edit: true })))).toBe('leave');
    // A founder hands over or deletes first: no "Verlassen".
    expect(crewAction(crew(viewer('member', 'founder', { edit: true })))).toBe('founder');
    // A hidden crew accepts no join (contract §4 crew state).
    expect(crewAction(crew(viewer('none', null, { join: true }), { status: 'hidden' }))).toBe('none');
  });
});

describe('CREW-03 member controls (contract §3 #24–#26)', () => {
  it('lets the founder act on anyone but themselves, an admin on plain members only', () => {
    expect(memberControls('founder', { role: 'admin', is_self: false })).toEqual({ remove: true, promote: false, demote: true, handOver: true });
    expect(memberControls('founder', { role: 'member', is_self: false })).toEqual({ remove: true, promote: true, demote: false, handOver: true });
    expect(memberControls('founder', { role: 'founder', is_self: true })).toEqual({ remove: false, promote: false, demote: false, handOver: false });
    expect(memberControls('admin', { role: 'member', is_self: false })).toEqual({ remove: true, promote: false, demote: false, handOver: false });
    expect(memberControls('admin', { role: 'admin', is_self: false }).remove).toBe(false);
    expect(memberControls('admin', { role: 'founder', is_self: false }).remove).toBe(false);
    expect(memberControls('member', { role: 'member', is_self: false }).remove).toBe(false);
  });

  it('orders founder → admins → members, each by joined_at', () => {
    const rows = [
      { role: 'member' as const, joined_at: '2026-11-02' },
      { role: 'admin' as const, joined_at: '2026-11-03' },
      { role: 'founder' as const, joined_at: '2026-11-04' },
      { role: 'member' as const, joined_at: '2026-11-01' },
    ];
    expect(byRole(rows).map((row) => `${row.role}:${row.joined_at}`)).toEqual(['founder:2026-11-04', 'admin:2026-11-03', 'member:2026-11-01', 'member:2026-11-02']);
  });
});

describe('CREW-02 the form (contract §4)', () => {
  const parse = (name: string, description = '') => crewFormSchema.safeParse({ name, description, bundesland: '', joinMode: 'open' });
  const issue = (name: string) => {
    const result = parse(name);
    return result.success ? null : result.error.issues[0]?.message;
  };

  it('collapses spaces and checks length, characters and reserved names', () => {
    const ok = parse('  Nordlicht   Crew  ');
    expect(ok.success && ok.data.name).toBe('Nordlicht Crew');
    expect(issue('ab')).toBe('form.errors.nameShort');
    expect(issue('x'.repeat(41))).toBe('form.errors.nameLong');
    expect(issue('Crew <script>')).toBe('form.errors.nameCharacters');
    expect(issue('Speedclub')).toBe('form.errors.nameReserved');
    expect(issue('Rock & Roll Crew!')).toBeNull();
    expect(issue('Süd-Ost 4.0')).toBeNull();
    expect(isReservedCrewName('  Offiziell ')).toBe(true);
    expect(parse('Nordlicht', 'x'.repeat(501)).success).toBe(false);
  });

  it('sends only what changed, null clears', () => {
    const before = { name: 'Nordlicht Crew', description: 'Ausfahrten', bundesland: 'HH' as const, joinMode: 'open' as const };
    expect(updateBody({ ...before }, before)).toEqual({});
    expect(updateBody({ ...before, description: '  ', bundesland: '', joinMode: 'request' }, before)).toEqual({ description: null, bundesland: null, join_mode: 'request' });
  });
});

describe('CREW-00 filters and cards', () => {
  it('reads q, Bundesland and sort from the address and never sorts by size', () => {
    expect(crewFiltersFromParams({ q: 'Nord', bundesland: 'hh', sort: 'newest' })).toEqual({ text: 'Nord', bundesland: 'HH', sort: 'newest' });
    expect(crewFiltersFromParams({ bundesland: 'XX', sort: 'members' })).toEqual({ text: '', bundesland: null, sort: 'name' });
    expect(crewQueryOf(' N ')).toBeNull();
    expect(crewQueryOf('  Nord   licht ')).toBe('Nord licht');
  });

  it('states the member count as a fact, and the sample has none', () => {
    const format = (n: number) => new Intl.NumberFormat('de-DE').format(n);
    expect(crewSubline(t, { bundesland_label: 'Hamburg', member_count: 12, is_sample: false }, format)).toBe('Hamburg · 12 Mitglieder');
    expect(crewSubline(t, { bundesland_label: null, member_count: 1, is_sample: false }, format)).toBe('1 Mitglied');
    expect(crewSubline(t, sampleCrew(t), format)).toBe('Hamburg');
  });
});

describe('contract §8 errors', () => {
  const error = (status: number, code: string, message = '') =>
    new ApiError({ kind: status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'validation', status, code, message });

  it('names the reason', () => {
    expect(crewErrorText(t, error(404, 'crew_unavailable'))).toBe('Diese Crew gibt es nicht mehr, oder du kannst sie nicht sehen.');
    expect(crewErrorText(t, error(409, 'limit_reached', 'Du bist schon in 5 Crews.'))).toBe('Du bist schon in 5 Crews.');
    expect(crewErrorText(t, error(409, 'limit_reached'))).toContain('höchstens 5 Crews');
    expect(crewErrorText(t, error(403, 'account_restricted'))).toContain('eingeschränkt');
    expect(crewErrorText(t, error(403, 'email_not_verified'))).toContain('E-Mail-Adresse');
    expect(crewErrorText(t, new Error('x'))).toBe('Das hat nicht geklappt. Versuch es gleich noch einmal.');
  });
});

describe('HOME-02 crew rows (contract §5)', () => {
  const home = i18n.getFixedT('de', 'home');
  const row = (details: Record<string, unknown>): AppNotification =>
    ({ id: 'n1', type: 'crew', actors: [], actor_count: 0, vehicle: null, details, created_at: '2026-11-21T10:00:00Z', read_at: null }) as unknown as AppNotification;

  it('says what happened and opens the right page', () => {
    const received = row({ state: 'request_received', crew_slug: 'nordlicht-crew', crew_name: 'Nordlicht Crew', username: 'lukas.sc', request_id: '01J' });
    expect(notificationText(received, home)).toBe('@lukas.sc möchte „Nordlicht Crew“ beitreten.');
    expect(notificationTarget(received, 'max')).toBe('/crews/nordlicht-crew/requests');
    const approved = row({ state: 'request_approved', crew_slug: 'nordlicht-crew', crew_name: 'Nordlicht Crew', username: null });
    expect(notificationText(approved, home)).toBe('Du bist jetzt Mitglied von „Nordlicht Crew“.');
    expect(notificationTarget(approved, 'max')).toBe('/crews/nordlicht-crew');
    const invited = row({ state: 'invited', crew_slug: 'nordlicht-crew', crew_name: 'Nordlicht Crew', username: 'nina.r34', invite_id: '01J' });
    expect(notificationText(invited, home)).toBe('@nina.r34 hat dich zu „Nordlicht Crew“ eingeladen.');
    expect(notificationTarget(invited, 'max')).toBe('/crews/invites');
    expect(notificationTarget(row({ state: 'request_approved', crew_slug: '../admin' }), 'max')).toBeNull();
    expect(notificationCategory({ type: 'crew' })).toBe('social');
    expect(notificationIcon({ type: 'crew' })).toBe('users');
  });
});

describe('Entdecken › Crews', () => {
  it('is a segment only while the crews flag is on, after Forum', () => {
    expect(visibleSegments({ events: true, forum: true }).map((entry) => entry.value)).toEqual(['builds', 'events', 'forum']);
    expect(visibleSegments({ events: true, forum: true, crews: true }).map((entry) => entry.value)).toEqual(['builds', 'events', 'forum', 'crews']);
    expect(visibleSegments({ crews: true }).map((entry) => entry.value)).toEqual(['builds', 'crews']);
  });
});
