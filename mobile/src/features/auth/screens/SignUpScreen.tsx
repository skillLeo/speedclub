import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Controller, useForm, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PixelRatio, StyleSheet, View, type TextInput as RNTextInput, type TextStyle } from 'react-native';

import { ApiError } from '@/api/client';
import { useRegister } from '@/api/queries/auth';
import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, size, typography, useTheme } from '@/theme';
import { Button, Checkbox, Icon, Text } from '@/ui';
import { useFocusRing } from '@/ui/useFocusRing';

import { AuthScreen, FooterLink } from '../components/AuthScreen';
import { EMAIL_INPUT, FormField } from '../components/FormField';
import { FormNotice } from '../components/FormNotice';
import { RuleList } from '../components/RuleList';
import { handEmailTo, useHandedEmail } from '../emailHandoff';
import { applyServerErrors, fieldMessage, onlyEmailDirty, useLeaveForm, useReturnToParam } from '../forms';
import { holdRegistrationPassword } from '../pendingRegistration';
import { forgetSignupOrigin, signupRef } from '../signupRef';
import { passwordChecks, signUpSchema, type SignUpValues } from '../schemas';

/** DQ-150: a name that wraps inside the link keeps its padding, margin and round corners on each of its lines. */
const BOX_PER_LINE = (isWeb ? { boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } : {}) as TextStyle;

const useStyles = createStyles((t) => ({
  field: { gap: t.space[8] },
  // A row is as tall as its label, and its 44 target reaches into the space around it (see Consent). 24 between rows keeps
  // the 48 pitch of 44 rows 4 apart, and the targets of neighbouring rows apart.
  consents: { gap: t.space[24] },
  // The error stands 12 under the label, where a 44 row put it.
  consent: { gap: t.space[12] },
  consentRow: { alignItems: 'flex-start', columnGap: t.space[12], flexDirection: 'row' },
  box: { width: t.size.checkbox },
  // 44 × 44, centred on the box and on the label's first line. It ends 1 before the label (22 + 11 against 22 + 12).
  target: { left: (t.size.checkbox - t.size.touchMin) / 2, position: 'absolute' },
  label: { flex: 1, minWidth: 0 },
  // §5: underlined, so it reads as a link without colour.
  link: { textDecorationLine: 'underline' },
  // DQ-148: a link inside a sentence draws its ring in the word gap, not across the neighbouring letters. The 2 of padding
  // with half the ring inside them centre it in the 4.4 of a word space at 16 (1.4 from "die", 1 from "AGB"); the negative
  // margin keeps the text where it is. Rounded like the inset rings. Closing punctuation joins the box (see DocLink), so
  // the ring never crosses a full stop.
  inlineRing: {
    borderRadius: t.radius.xs,
    marginHorizontal: -t.space[2],
    outlineOffset: -t.size.border.focusRing / 2,
    paddingHorizontal: t.space[2],
    ...BOX_PER_LINE,
  },
  error: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[4], paddingBottom: t.space[4] },
  errorIcon: { paddingTop: t.space[2] },
  errorText: { flexShrink: 1 },
}));

type ConsentName = 'ageConfirmed' | 'termsAccepted' | 'privacyAccepted' | 'marketingConsent';

type ConsentProps = {
  control: Control<SignUpValues>;
  name: ConsentName;
  /** The sentence. For a linked consent the document's name in it is marked `<doc>…</doc>`. */
  label: string;
  /** The legal document the marked name opens. */
  href?: Href;
};

const DOC_LINK = /^([\s\S]*?)<doc>([\s\S]+?)<\/doc>([\s\S]*)$/;

/**
 * DQ-142: the document's name is a link inside its consent's sentence ("Ich akzeptiere die AGB."), so it cannot be read
 * as part of the next row. Returns the sentence around it, or null for a sentence without a marked name.
 */
export function splitDocLink(sentence: string): { before: string; link: string; after: string } | null {
  const match = DOC_LINK.exec(sentence);
  if (!match) return null;
  return { before: match[1] ?? '', link: match[2] ?? '', after: match[3] ?? '' };
}

/** The sentence as the checkbox's name: the whole of it, without the marks. */
export function plainSentence(sentence: string): string {
  return sentence.replace(/<\/?doc>/g, '');
}

/** Punctuation that closes the document's name, as the full stop in "die AGB.". */
const CLOSING_PUNCTUATION = /^[.,;:!?)\]«»“”"'’]+/u;

/**
 * DQ-148: the punctuation right after the link, and the rest. Nothing separates it from the name, so a ring around the
 * name alone would cross it; it stands inside the link's focus box instead.
 */
export function splitClosingPunctuation(text: string): { closing: string; rest: string } {
  const closing = CLOSING_PUNCTUATION.exec(text)?.[0] ?? '';
  return { closing, rest: text.slice(closing.length) };
}

/**
 * The document link: a real link on web (a new tab with the keyboard or a middle click), the token focus ring. Only the
 * name is underlined; `closing` sits inside the ring, after it, and stays out of the link's name.
 */
function DocLink({ href, label, closing, testID }: { href: Href; label: string; closing: string; testID: string }) {
  const styles = useStyles();
  const focus = useFocusRing();
  // Web: the click must not reach the sentence around it, which ticks the box.
  const keepToLink = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <Link href={href} push asChild onPress={keepToLink}>
      <Text
        variant="body"
        role="link"
        aria-label={label}
        // One object: Link's Slot merges the child's style by spreading it, which would turn an array into numbered keys.
        style={StyleSheet.flatten([focus.ringStyle, styles.inlineRing])}
        // tabIndex: Safari leaves a plain link out of the Tab order, unlike the app's other links, which are tab stops.
        {...(isWeb ? ({ tabIndex: 0, onFocus: focus.onFocus, onBlur: focus.onBlur } as object) : {})}
        testID={testID}
      >
        <Text variant="body" style={styles.link}>
          {label}
        </Text>
        {closing}
      </Text>
    </Link>
  );
}

/**
 * One consent: the box in its 44 target, and the sentence beside it, which ticks the box too. The link to a document sits
 * in the sentence, beside the checkbox and not inside it, so it never ticks the box (WCAG 2.5.8 inline exception). The
 * checkbox is named by the whole sentence; the sentence of a consent without a link is the same text, so it is hidden.
 */
function Consent({ control, name, label, href }: ConsentProps) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const theme = useTheme();
  const parts = href ? splitDocLink(label) : null;
  const after = splitClosingPunctuation(parts?.after ?? '');
  const sentence = plainSentence(label);
  // As SelectionControl does with alignFirstLine: the box centres on the first line at the scale it renders with.
  const lineHeight = typography.body.lineHeight * (isWeb ? theme.fontScale : PixelRatio.getFontScale());
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const error = fieldMessage(t, fieldState.error);
        const toggle = () => {
          haptics.selection();
          field.onChange(!field.value);
        };
        return (
          <View style={styles.consent}>
            <View style={styles.consentRow}>
              <View style={[styles.box, { height: lineHeight }]}>
                <Checkbox
                  checked={field.value}
                  onChange={field.onChange}
                  label={sentence}
                  error={Boolean(error)}
                  style={[styles.target, { top: (lineHeight - size.touchMin) / 2 }]}
                  testID={`AUTH-04.${name}`}
                />
              </View>
              <Text
                variant="body"
                selectable={false}
                aria-hidden={parts ? undefined : true}
                onPress={toggle}
                style={styles.label}
                testID={`AUTH-04.${name}.label`}
              >
                {parts && href ? (
                  <>
                    {parts.before}
                    <DocLink href={href} label={parts.link} closing={after.closing} testID={`AUTH-04.${name}.read`} />
                    {after.rest}
                  </>
                ) : (
                  sentence
                )}
              </Text>
            </View>
            {error ? (
              <View style={styles.error}>
                <View style={styles.errorIcon}>
                  <Icon name="warning" size={16} color="accent.fg" />
                </View>
                <Text variant="helper" color="accent.fg" role="alert" style={styles.errorText} testID={`AUTH-04.${name}.error`}>
                  {error}
                </Text>
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

/** AUTH-04. The answer never says whether an address is known: a known one gets a mail instead of a code. */
export function SignUpScreen() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; returnTo?: string; next?: string }>();
  useReturnToParam(params);
  const handedEmail = useHandedEmail('/sign-up', params.email);
  const passwordRef = useRef<ComponentRef<typeof RNTextInput>>(null);
  const register = useRegister();
  const [notice, setNotice] = useState<string | null>(null);
  const { leaving, leave } = useLeaveForm();

  const { control, handleSubmit, setError, getValues, formState } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: 'onTouched',
    defaultValues: {
      email: handedEmail ?? '',
      password: '',
      ageConfirmed: false,
      termsAccepted: false,
      privacyAccepted: false,
      marketingConsent: false,
    },
  });
  // Read during render: React Hook Form only tracks the parts of formState that render reads.
  const { isDirty, dirtyFields } = formState;
  const password = useWatch({ control, name: 'password' });
  const email = useWatch({ control, name: 'email' });
  const checks = passwordChecks(password, email);

  const onSubmit = handleSubmit(async (values) => {
    setNotice(null);
    try {
      const next = await register.mutateAsync({
        email: values.email,
        password: values.password,
        marketingConsent: values.marketingConsent,
        ref: signupRef(),
      });
      forgetSignupOrigin();
      holdRegistrationPassword(next.email, values.password);
      handEmailTo('/verify-email', next.email);
      router.push({ pathname: '/verify-email', params: { resend: String(next.resend_after_seconds ?? 0) } });
    } catch (error) {
      if (error instanceof ApiError) {
        setNotice(
          applyServerErrors(error, setError, {
            email: 'email',
            password: 'password',
            accepted_age_16: 'ageConfirmed',
            accepted_terms: 'termsAccepted',
            accepted_privacy: 'privacyAccepted',
            marketing_consent: 'marketingConsent',
          }),
        );
      } else {
        setNotice(t('common.serverError'));
      }
    }
  });

  const toSignIn = () => {
    handEmailTo('/sign-in', getValues('email'));
    const target = '/sign-in';
    if (onlyEmailDirty(dirtyFields)) leave(target);
    else router.replace(target);
  };

  return (
    <AuthScreen
      routeId="AUTH-04"
      title={t('signUp.title')}
      subtitle={t('signUp.subtitle')}
      skeletonFields={2}
      dirty={isDirty && !leaving && !register.isPending && !register.isSuccess}
      cta={{ label: t('signUp.submit'), onPress: () => void onSubmit(), loading: register.isPending }}
      footer={
        <FooterLink text={t('signUp.hasAccount')}>
          <Button
            label={t('signUp.toSignIn')}
            variant="tertiary"
            size="m"
            role="link"
            flush="start"
            onPress={toSignIn}
            testID="AUTH-04.toSignIn"
          />
        </FooterLink>
      }
    >
      {notice ? <FormNotice message={notice} testID="AUTH-04.notice" /> : null}
      <FormField
        control={control}
        name="email"
        label={t('fields.email')}
        {...EMAIL_INPUT}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
        testID="AUTH-04.email"
      />
      <View style={styles.field}>
        <FormField
          control={control}
          name="password"
          label={t('fields.password')}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          testID="AUTH-04.password"
          inputRef={passwordRef}
        />
        <RuleList
          testID="AUTH-04.rules"
          rules={[
            { key: 'length', label: t('rules.length'), met: checks.length },
            { key: 'notEmail', label: t('rules.notEmail'), met: checks.notEmail },
            { key: 'common', label: t('rules.common'), met: null },
          ]}
        />
      </View>
      <View style={styles.consents}>
        <Consent control={control} name="ageConfirmed" label={t('signUp.age')} />
        <Consent control={control} name="termsAccepted" label={t('signUp.terms')} href="/settings/legal/terms" />
        <Consent control={control} name="privacyAccepted" label={t('signUp.privacy')} href="/settings/legal/privacy" />
        <Consent control={control} name="marketingConsent" label={t('signUp.marketing')} />
      </View>
    </AuthScreen>
  );
}
