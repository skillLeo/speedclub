import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { COLLECTION_NAME_MAX } from '@/api/queries/social2';
import { hapticFor } from '@/lib/haptics';
import { createStyles } from '@/theme';
import { Button, Sheet, Text, TextInput } from '@/ui';

const useStyles = createStyles((t) => ({
  body: { gap: t.space[16] },
}));

export type CollectionNameSheetProps = {
  visible: boolean;
  /** `create` names a new collection, `rename` an existing one. */
  mode: 'create' | 'rename';
  /** The current name when renaming. */
  initialName?: string;
  onClose: () => void;
  /** Resolves when saved; a rejection keeps the sheet open with the server's message. */
  onSubmit: (name: string) => Promise<unknown>;
  testID: string;
};

/** The parent gives it a new `key` on every open, so it starts from `initialName`. The name sheet of COL-01/02: "Neue Sammlung" and "Umbenennen". Names are 1–60 characters; collections are always private. */
export function CollectionNameSheet({ visible, mode, initialName = '', onClose, onSubmit, testID }: CollectionNameSheetProps) {
  const { t } = useTranslation('profile');
  const styles = useStyles();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const unchanged = mode === 'rename' && trimmed === initialName.trim();

  const submit = async () => {
    if (saving || unchanged) return;
    if (!trimmed) {
      hapticFor('validationErrorOnSubmit');
      setError(t('collections.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (failure) {
      hapticFor('validationErrorOnSubmit');
      setError(failure instanceof Error && failure.message ? failure.message : t('collections.failed'));
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create' ? t('collections.new') : t('collections.rename');
  return (
    <Sheet visible={visible} onClose={onClose} title={title} label={title} expandable={false} narrow testID={testID}>
      <View style={styles.body}>
        <Text variant="callout" color="text.secondary">
          {t('collections.privateNote')}
        </Text>
        <TextInput
          label={t('collections.name')}
          value={name}
          onChangeText={(next) => {
            setName(next);
            if (error) setError(null);
          }}
          error={error ?? undefined}
          maxLength={COLLECTION_NAME_MAX}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          testID={`${testID}.name`}
        />
        <Button
          label={mode === 'create' ? t('collections.create') : t('collections.save')}
          size="l"
          fullWidth
          onPress={() => void submit()}
          disabled={unchanged}
          loading={saving}
          testID={`${testID}.submit`}
        />
      </View>
    </Sheet>
  );
}
