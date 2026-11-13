import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '@/api/client';
import type { Me } from '@/api/queries/auth';
import { FormNotice } from '@/features/auth/components/FormNotice';
import { applyServerErrors } from '@/features/auth/forms';
import { createStyles, size } from '@/theme';
import { Skeleton, SkeletonBlock, SkeletonText, Text, TextInput, toast } from '@/ui';
import { SlotText, slot } from '@/ui/SlotText';
import { identifierText } from '@/ui/textBreaks';

import { useMemberGate } from '../components/MemberGate';
import { RestrictionNotice } from '../components/RestrictionNotice';
import { RowGroup } from '@/ui/RowGroup';
import { RadioRows } from '../components/SettingRows';
import { SettingsPage } from '../components/SettingsPage';
import { useFailureMessage, useFieldMessage } from '../forms';
import { SUPPORT_CATEGORIES, useCreateSupportTicket, type SupportCategory } from '@/api/queries/settings';
import { isSupportCategory, MESSAGE_MAX_LENGTH, SUBJECT_MAX_LENGTH, supportTicketSchema, type SupportTicketValues } from '../schemas';

const ROUTE = 'SET-15';
const MESSAGE_ROWS = 8;

const useStyles = createStyles((t) => ({
  body: { gap: t.space[24] },
  fields: { gap: t.space[16] },
  field: { gap: t.space[8] },
}));

function ContactSkeleton() {
  const styles = useStyles();
  return (
    <Skeleton testID={`${ROUTE}.skeleton`}>
      <View style={styles.body}>
        <SkeletonText variant="body" lines={2} />
        <SkeletonBlock height={size.row.single * SUPPORT_CATEGORIES.length} corner="md" />
        <View style={styles.field}>
          <SkeletonText variant="callout" width="30%" />
          <SkeletonBlock height={size.input} corner="sm" />
        </View>
      </View>
    </Skeleton>
  );
}

/** A ticket reference as the receipt mail names it ("SC-7H2KQXMB"); anything else is none. */
export function referenceOf(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && /^SC-[A-Z0-9]{4,16}$/.test(value) ? value : null;
}

/**
 * SET-15 /settings/help/contact: a category, a subject and the message; the ticket reaches the support team (ADM-25) and the
 * answer comes by e-mail to the account's address. Guests use the web form /kontakt (WEB-10).
 */
function ContactForm({ me }: { me: Me }) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const fieldMessage = useFieldMessage();
  const failure = useFailureMessage();
  const create = useCreateSupportTicket();
  const params = useLocalSearchParams<{ about?: string | string[]; category?: string | string[] }>();
  const followUp = { about: referenceOf(params.about), category: typeof params.category === 'string' ? params.category : '' };
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { control, handleSubmit, setError, formState } = useForm<SupportTicketValues>({
    resolver: zodResolver(supportTicketSchema),
    mode: 'onTouched',
    // M3.5: a follow-up from SET-15b arrives with the reference and the topic, so the team can link it (ADM-25).
    defaultValues: {
      category: isSupportCategory(followUp.category) ? followUp.category : '',
      subject: followUp.about ? t('requests.followUpSubject', { reference: followUp.about }) : '',
      message: '',
    },
  });
  const message = useWatch({ control, name: 'message' });

  useEffect(() => {
    if (!sent) return;
    if (router.canGoBack()) router.back();
    else router.replace('/settings/help');
  }, [router, sent]);

  const onSubmit = handleSubmit(async (values) => {
    if (!isSupportCategory(values.category)) return;
    setNotice(null);
    try {
      await create.mutateAsync({ category: values.category, subject: values.subject.trim(), message: values.message.trim() });
      toast(t('contact.sent'), { haptic: 'success', testID: `${ROUTE}.sent` });
      setSent(true);
    } catch (error) {
      setNotice(
        error instanceof ApiError
          ? applyServerErrors(error, setError, { category: 'category', subject: 'subject', message: 'message' })
          : failure(error),
      );
    }
  });

  return (
    <SettingsPage
      routeId={ROUTE}
      title={t('contact.title')}
      fallback="/settings/help"
      offlineLabel={t('offlineForm')}
      section="contact"
      form={{
        dirty: formState.isDirty && !create.isPending && !sent,
        cta: { label: t('contact.submit'), onPress: () => void onSubmit(), loading: create.isPending },
      }}
    >
      <View style={styles.body}>
        <RestrictionNotice routeId={ROUTE} scope="support" />
        {/* DQ-927: the address as on file, never hyphenated. */}
        <SlotText variant="body" color="text.secondary" text={t('contact.intro', { email: slot('email') })} slots={{ email: identifierText(me.email) }} testID={`${ROUTE}.intro`} />
        {notice ? <FormNotice message={notice} testID={`${ROUTE}.notice`} /> : null}
        <Controller
          control={control}
          name="category"
          render={({ field, fieldState }) => (
            <View style={styles.field}>
              <RowGroup title={t('contact.category')} testID={`${ROUTE}.categoryGroup`}>
                <RadioRows<SupportCategory>
                  label={t('contact.category')}
                  value={isSupportCategory(field.value) ? field.value : null}
                  onChange={field.onChange}
                  options={SUPPORT_CATEGORIES.map((category) => ({ value: category, label: t(`contact.categories.${category}`) }))}
                  testID={`${ROUTE}.category`}
                />
              </RowGroup>
              {fieldState.error ? (
                <Text variant="caption" color="accent.fg" role="alert" testID={`${ROUTE}.category.error`}>
                  {fieldMessage(fieldState.error)}
                </Text>
              ) : null}
            </View>
          )}
        />
        <View style={styles.fields}>
          <Controller
            control={control}
            name="subject"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('contact.subject')}
                error={fieldMessage(fieldState.error)}
                maxLength={SUBJECT_MAX_LENGTH}
                returnKeyType="next"
                testID={`${ROUTE}.subject`}
              />
            )}
          />
          <Controller
            control={control}
            name="message"
            render={({ field, fieldState }) => (
              <TextInput
                ref={field.ref}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                label={t('contact.message')}
                helper={t('contact.messageCount', { count: message.length, max: MESSAGE_MAX_LENGTH })}
                error={fieldMessage(fieldState.error)}
                multiline
                maxRows={MESSAGE_ROWS}
                maxLength={MESSAGE_MAX_LENGTH}
                testID={`${ROUTE}.message`}
              />
            )}
          />
          <Text variant="callout" color="text.secondary" testID={`${ROUTE}.privacy`}>
            {t('contact.privacyNote')}
          </Text>
        </View>
      </View>
    </SettingsPage>
  );
}

export function ContactScreen() {
  const { t } = useTranslation('settings');
  const gate = useMemberGate({ routeId: ROUTE, returnTo: '/settings/help/contact', skeleton: <ContactSkeleton /> });
  if (gate.me) return <ContactForm me={gate.me} />;
  return (
    <SettingsPage routeId={ROUTE} title={t('contact.title')} fallback="/settings/help" offlineLabel={t('offlineForm')} section="contact">
      {gate.fallback}
    </SettingsPage>
  );
}
