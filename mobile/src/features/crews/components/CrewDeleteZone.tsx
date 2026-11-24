import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeleteCrew, type Crew } from '@/api/queries/crews';
import { FormGroup } from '@/features/garage/components/fields';
import { haptics } from '@/lib/haptics';
import { useOnline } from '@/state/online';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Text } from '@/ui/Text';
import { TextInput } from '@/ui/TextInput';
import { toast } from '@/ui/toast';

import { crewErrorText } from '../model';

const useStyles = createStyles(() => ({
  button: { alignSelf: 'flex-start' },
}));

/** True when the typed text is the crew's name (case and outer spaces aside): the delete stays off until then. */
export function deleteNameMatches(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase();
}

/**
 * CREW-02 edit, the founder's delete at the end of the form (R4DQ-30, moved from CREW-03): what deleting removes, "Crew
 * löschen" in the destructive tone, and the dialog that asks for the crew's name before the same DELETE as before (contract §3 #12).
 */
export function CrewDeleteZone({ crew, routeId, onDeleted }: { crew: Crew; routeId: string; onDeleted: () => void }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const online = useOnline();
  const destroy = useDeleteCrew();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const matches = deleteNameMatches(typed, crew.name);

  const close = () => {
    setOpen(false);
    setTyped('');
  };
  const confirm = () =>
    destroy.mutate(
      { slug: crew.slug, confirmName: typed.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          haptics.success();
          toast(t('manage.deleted', { name: crew.name }), { testID: `${routeId}.toast` });
          onDeleted();
        },
        onError: (error) => {
          haptics.error();
          toast(crewErrorText(t, error), { testID: `${routeId}.toast` });
        },
      },
    );

  return (
    // R4DQ-52: no section title; the explainer and the red action say what this is.
    <FormGroup testID={`${routeId}.dangerZone`}>
      <Text variant="caption" color="text.secondary">
        {t('manage.deleteHelper')}
      </Text>
      <Button
        label={t('manage.delete')}
        variant="destructive"
        size="m"
        flush="start"
        icon="trash"
        disabled={!online}
        onPress={() => {
          haptics.warning();
          setOpen(true);
        }}
        style={styles.button}
        testID={`${routeId}.delete`}
      />
      <Dialog
        visible={open}
        onClose={close}
        title={t('manage.deleteTitle', { name: crew.name })}
        body={t('manage.deleteBody')}
        actions={[
          { label: t('manage.deleteConfirm'), onPress: confirm, destructive: true, disabled: !matches || !online, loading: destroy.isPending, testID: `${routeId}.delete.confirm` },
          { label: t('cancel'), onPress: close, variant: 'tertiary', testID: `${routeId}.delete.cancel` },
        ]}
        testID={`${routeId}.deleteDialog`}
      >
        <TextInput
          label={t('manage.deleteName', { name: crew.name })}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          testID={`${routeId}.delete.name`}
        />
      </Dialog>
    </FormGroup>
  );
}
