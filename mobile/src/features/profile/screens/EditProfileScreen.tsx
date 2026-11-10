import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useChooseUsername, useMe, useUsernameCheck, type Me, type UsernameReason } from '@/api/queries/auth';
import { useSaveProfile } from '@/api/queries/profile';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import { useHeldForm } from '@/features/auth/heldForm';
import { applyServerErrors, isCode, useDebouncedValue } from '@/features/auth/forms';
import { normalizeUsername, USERNAME_MAX_LENGTH, usernameViolations } from '@/features/auth/schemas';
import { useHideTabBar } from '@/features/shell/tabBarLayout';
import { now } from '@/lib/clock';
import { useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, layout, size, typography, useBreakpoint, useMotion, useTheme } from '@/theme';
import {
  Button,
  DiscardGuardDialog,
  ErrorState,
  Header,
  Icon,
  OfflineBanner,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  StickyCTABar,
  Text,
  TextInput,
  toast,
  useCollapsingHeader,
  type CollapsingHeader,
} from '@/ui';

import { GuestInvitation } from '../components/GuestInvitation';
import { ProfileImagesEditor } from '../components/ProfileImagesEditor';
import {
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  editProfileSchema,
  profilePatch,
  profileValues,
  usernameCooldownUntil,
  type EditProfileValues,
} from '../schemas';
import { useProfileRestriction } from './ProfileScreen';

const EDGES: readonly Edge[] = ['left', 'right'];
/** Long enough that typing a name in one go asks once (as AUTH-08). */
const CHECK_DEBOUNCE_MS = 300;
/** A focused field keeps this much air above the keyboard and the sticky bar. */
const KEYBOARD_OFFSET = size.button.l + size.touchMin;
const FORM_MAX_WIDTH = layout.feedColumn;
const BIO_ROWS = 5;
/** DQ-133: the bio grows with its text up to this share of the window before it scrolls inside, at any font scale. */
const BIO_MAX_SHARE = 0.4;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[8] },
  // DQ-136: the profile tab's one desktop model (DQ-114): the column starts on the gutter, as on PROF-01 and the settings.
  column: { alignSelf: 'flex-start', gap: t.space[24], maxWidth: FORM_MAX_WIDTH, width: '100%' },
  fields: { gap: t.space[16] },
  field: { gap: t.space[8] },
  available: { alignItems: 'center', flexDirection: 'row', gap: t.space[4] },
  centred: { flex: 1, justifyContent: 'center' },
  skeletonAvatar: { alignSelf: 'flex-start', marginLeft: t.space[16], marginTop: -t.space[32] },
  // The canvas ring of the real avatar, so the circle reads apart from the cover block.
  skeletonRing: {
    backgroundColor: t.color.bg.canvas,
    borderRadius: t.radius.full,
    bottom: -t.space[2],
    left: -t.space[2],
    position: 'absolute',
    right: -t.space[2],
    top: -t.space[2],
  },
  skeletonField: { gap: t.space[8] },
}));

/** A message from Zod is a key with its namespace; a message from the server is already translated. */
function useFieldMessage() {
  const { t } = useTranslation(['profile', 'auth']);
  return (error: FieldError | undefined) => {
    if (!error?.message) return undefined;
    return error.type === 'server' ? error.message : t(error.message);
  };
}

function EditSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID="PROF-03.skeleton">
      <View style={styles.column}>
        <View>
          <SkeletonBlock aspectRatio={3} corner="md" />
          <View style={styles.skeletonAvatar}>
            <View style={styles.skeletonRing} />
            <SkeletonBlock width={size.avatar.xl} height={size.avatar.xl} corner="full" />
          </View>
        </View>
        <View style={styles.fields}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={styles.skeletonField}>
              <SkeletonText variant="labelS" width="30%" />
              <SkeletonBlock height={size.input} corner="sm" />
            </View>
          ))}
        </View>
      </View>
    </Skeleton>
  );
}

/**
 * DQ-259: a save that failed because the session ended (401, a write refused for another tab's member, or the request
 * aborted at sign-out) is told by the held notice and the dialog alone; a second "versuch es noch einmal" would ask for a
 * retry the disabled CTA does not allow.
 */
export function endedWithSession(error: unknown): boolean {
  if (error instanceof ApiError) return error.kind === 'unauthenticated' || error.kind === 'session_moved';
  return error instanceof Error && error.name === 'AbortError';
}

function EditProfileForm({ me, header, held }: { me: Me; header: CollapsingHeader; held: boolean }) {
  const { t } = useTranslation('profile');
  const authT = useTranslation('auth').t;
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const format = useFormat();
  const fieldMessage = useFieldMessage();
  const { gutter, kind, width } = useBreakpoint();
  // DQ-136: from the tablet on, "Speichern" stands right under the form, as on the forms of the auth stack (DQ-115).
  const wide = kind !== 'phone';
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const theme = useTheme();
  const bioRows = Math.max(BIO_ROWS, Math.floor((windowHeight * BIO_MAX_SHARE) / (typography.body.lineHeight * theme.fontScale)));
  // M3.5: a read-only view as the member locks the form like a restriction, with the view-as reason.
  const viewAsLock = useViewAsLock();
  const profileRestriction = useProfileRestriction(me);
  const restriction = viewAsLock ?? profileRestriction;
  const save = useSaveProfile();
  const changeUsername = useChooseUsername();
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const currentUsername = me.username ?? '';
  const schema = useMemo(() => editProfileSchema(currentUsername), [currentUsername]);
  const { control, handleSubmit, setError, resetField, formState } = useForm<EditProfileValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: profileValues(me),
  });
  // Read during render: React Hook Form only tracks the parts of formState that render reads.
  const { isDirty, dirtyFields } = formState;

  const username = normalizeUsername(useWatch({ control, name: 'username' }));
  const bio = useWatch({ control, name: 'bio' });
  const debounced = useDebouncedValue(username, CHECK_DEBOUNCE_MS);
  const changed = username !== currentUsername;
  const checkable = changed && usernameViolations(username).length === 0 && username === debounced ? username : null;
  const check = useUsernameCheck(checkable);
  const reason: UsernameReason | null = check.data && check.data.username === checkable ? check.data.reason : null;
  const available = Boolean(checkable && check.data?.username === checkable && check.data.available);
  const cooldownUntil = usernameCooldownUntil(me, now());

  const pending = save.isPending || changeUsername.isPending;
  const locked = restriction !== null;
  // BH-30: the session ended under this form. It stays, with its text, until the member chooses; nothing can be saved till then.
  const disabled = locked || !online || held;
  const columnWidth = Math.min(FORM_MAX_WIDTH, (width || windowWidth) - 2 * gutter);
  // On a wide phone the column stops at 640: the bar's button ends where it does.
  const barPadding = { paddingLeft: gutter, paddingRight: Math.max(gutter, width - gutter - FORM_MAX_WIDTH) };

  // The bodies that replace the form do not scroll: no hairline over them for an offset the form left behind.
  const { scrollY } = header;
  useEffect(() => () => scrollY.set(0), [scrollY]);

  // DQ-249, as GAR-05's revealTop: the held notice stands at the top, and a member who saved from the bottom would not see it.
  const scroll = useRef<KeyboardAwareScrollViewRef>(null);
  const motion = useMotion();
  const animated = motion.enabled && !motion.reduced;
  useEffect(() => {
    if (held) scroll.current?.scrollTo({ y: 0, animated });
  }, [animated, held]);

  // After a save the guard must be off before leaving: this effect runs after the guard's own in the same commit.
  useEffect(() => {
    if (!saved) return;
    if (router.canGoBack()) router.back();
    else router.replace('/profile');
  }, [router, saved]);

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null);
    const nextUsername = normalizeUsername(values.username);
    const patch = profilePatch(values, dirtyFields);
    let usernameChanged = false;
    if (nextUsername !== currentUsername) {
      try {
        await changeUsername.mutateAsync(nextUsername);
        usernameChanged = true;
        resetField('username', { defaultValue: nextUsername });
      } catch (error) {
        if (isCode(error, 'username_change_cooldown') && error instanceof ApiError) {
          setError('username', { type: 'server', message: error.message }, { shouldFocus: true });
        } else if (!endedWithSession(error)) {
          setNotice(error instanceof ApiError ? applyServerErrors(error, setError, { username: 'username' }) : t('edit.serverError'));
        }
        return;
      }
    }
    if (Object.keys(patch).length > 0) {
      try {
        await save.mutateAsync(patch);
      } catch (error) {
        if (endedWithSession(error)) return;
        const rest =
          error instanceof ApiError
            ? applyServerErrors(error, setError, { display_name: 'displayName', city: 'city', bio: 'bio' })
            : t('edit.serverError');
        setNotice(usernameChanged ? t('edit.usernameOnly') : rest);
        return;
      }
    }
    toast(t('edit.saved'), { haptic: 'success', testID: 'PROF-03.saved' });
    setSaved(true);
  });

  const usernameHelper = cooldownUntil
    ? t('edit.fields.usernameCooldown', { date: format.dateTime(cooldownUntil) })
    : t('edit.fields.usernameHelper');

  return (
    <>
      {/* Its scroller is a Reanimated ScrollView, which runs the header's scroll handler on the UI thread (DQ-146). */}
      <KeyboardAwareScrollView
        {...header.scrollProps}
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={KEYBOARD_OFFSET}
        testID="PROF-03.scroll"
      >
        <View style={styles.column}>
          {restriction || held ? <FormNotice message={restriction ?? authT('session.heldNotice')} tone="info" testID="PROF-03.restricted" /> : null}
          {notice && !held ? <FormNotice message={notice} testID="PROF-03.notice" /> : null}
          <ProfileImagesEditor me={me} width={columnWidth} disabled={disabled} />
          <View style={styles.fields}>
            <Controller
              control={control}
              name="displayName"
              render={({ field, fieldState }) => (
                <TextInput
                  ref={field.ref}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  label={t('edit.fields.displayName')}
                  helper={t('edit.fields.displayNameHelper')}
                  error={fieldMessage(fieldState.error)}
                  disabled={locked}
                  autoComplete="name"
                  textContentType="name"
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  testID="PROF-03.displayName"
                />
              )}
            />
            <View style={styles.field}>
              <Controller
                control={control}
                name="username"
                render={({ field, fieldState }) => (
                  <TextInput
                    ref={field.ref}
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    label={t('edit.fields.username')}
                    helper={usernameHelper}
                    error={fieldMessage(fieldState.error) ?? (reason ? authT(`username.reason.${reason}`) : undefined)}
                    loading={check.isFetching}
                    disabled={locked || cooldownUntil !== null}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    spellCheck={false}
                    maxLength={USERNAME_MAX_LENGTH}
                    testID="PROF-03.username"
                  />
                )}
              />
              {available ? (
                <View style={styles.available} role="status" testID="PROF-03.username.available">
                  <Icon name="check" size={16} color="status.success" />
                  <Text variant="helper" color="status.success">
                    {t('edit.fields.usernameAvailable')}
                  </Text>
                </View>
              ) : null}
              {check.isError && checkable ? (
                <Text variant="helper" color="text.secondary" role="status" testID="PROF-03.username.checkFailed">
                  {t('edit.fields.usernameCheckFailed')}
                </Text>
              ) : null}
            </View>
            <Controller
              control={control}
              name="city"
              render={({ field, fieldState }) => (
                <TextInput
                  ref={field.ref}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  label={t('edit.fields.city')}
                  helper={t('edit.fields.cityHelper')}
                  error={fieldMessage(fieldState.error)}
                  disabled={locked}
                  textContentType="addressCity"
                  maxLength={CITY_MAX_LENGTH}
                  testID="PROF-03.city"
                />
              )}
            />
            <Controller
              control={control}
              name="bio"
              render={({ field, fieldState }) => (
                <TextInput
                  ref={field.ref}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  label={t('edit.fields.bio')}
                  helper={t('edit.fields.bioCount', { count: bio.length, max: BIO_MAX_LENGTH })}
                  error={fieldMessage(fieldState.error)}
                  disabled={locked}
                  multiline
                  maxRows={bioRows}
                  maxLength={BIO_MAX_LENGTH}
                  testID="PROF-03.bio"
                />
              )}
            />
          </View>
          {wide ? (
            <View testID="PROF-03.cta">
              <Button
                label={t('edit.save')}
                size="l"
                fullWidth
                onPress={() => void onSubmit()}
                loading={pending}
                disabled={disabled || !isDirty}
                testID="PROF-03.cta.primary"
              />
            </View>
          ) : null}
        </View>
      </KeyboardAwareScrollView>
      {wide ? null : (
        <StickyCTABar
          label={t('edit.save')}
          onPress={() => void onSubmit()}
          loading={pending}
          disabled={disabled || !isDirty}
          style={barPadding}
          testID="PROF-03.cta"
        />
      )}
      <DiscardGuardDialog dirty={isDirty && !pending && !saved} testID="PROF-03.discard" />
    </>
  );
}

/** PROF-03. Images upload on their own; the fields save together through one sticky "Speichern". */
export function EditProfileScreen() {
  useHideTabBar();
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const qaState = useQaState();
  const online = useOnline();
  const { gutter, kind } = useBreakpoint();
  const status = useSessionStore((state) => state.status);
  const me = useMe();
  const held = useHeldForm() && me.data !== undefined;
  // §8: the bar stays compact; its hairline fades in once the form scrolls under it (DQ-146).
  const header = useCollapsingHeader();
  // A request waiting for the network is paused, not loading: offline without a copy shows the offline state.
  const reachable = online && me.fetchStatus !== 'paused';

  let body: ReactNode;
  if (qaState === 'loading' || status === 'loading' || (status === 'member' && me.isPending && me.fetchStatus !== 'paused' && qaState !== 'error')) {
    body = (
      <View style={[styles.content, { paddingHorizontal: gutter }]}>
        <EditSkeleton />
      </View>
    );
  } else if (qaState === 'error' || (status === 'member' && !me.data)) {
    body = (
      <View style={styles.centred}>
        <ErrorState
          title={reachable ? t('error.title') : t('error.offlineTitle')}
          message={reachable ? undefined : t('error.offlineBody')}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
          testID="PROF-03.error"
        />
      </View>
    );
  } else if ((status !== 'member' && !held) || !me.data) {
    body = (
      <View style={[styles.content, { paddingHorizontal: gutter }]}>
        <View style={styles.column}>
          <GuestInvitation routeId="PROF-03" returnTo="/profile/edit" />
        </View>
      </View>
    );
  } else {
    body = <EditProfileForm key={me.data.id} me={me.data} header={header} held={held} />;
  }

  return (
    <Screen edges={EDGES} testID="PROF-03.root">
      {/* The header's controls span that column and its gutters, so back keeps the column's edge and the title centres on
          it; the bar stays as wide as the pane (DQ-144). */}
      <Header
        title={t('edit.title')}
        scroll={header}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
        contentMaxWidth={kind === 'phone' ? undefined : FORM_MAX_WIDTH + 2 * gutter}
        testID="PROF-03.header"
      />
      {online ? null : <OfflineBanner label={t('edit.offline')} testID="PROF-03.offline" />}
      {body}
    </Screen>
  );
}
