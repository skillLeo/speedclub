import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  COLLECTION_NAME_MAX,
  useCollections,
  useCreateCollection,
  useToggleCollectionItem,
  type CollectionItemType,
  type MemberCollection,
} from '@/api/queries/social2';
import { haptics } from '@/lib/haptics';
import { createStyles, space } from '@/theme';
import {
  Button,
  Checkbox,
  ErrorState,
  ListRow,
  Sheet,
  Skeleton,
  SkeletonText,
  Text,
  TextInput,
  toast,
} from '@/ui';

const SKELETON_ROWS = 3;

const useStyles = createStyles((t) => ({
  intro: { marginBottom: t.space[12] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  skeletonRow: { gap: t.space[4], paddingHorizontal: t.space[16], paddingVertical: t.space[12] },
  create: { gap: t.space[12], marginTop: t.space[20] },
}));

export type SaveSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** What is saved: a build, a mod or a build update (`me/collections` item types). */
  item: { type: CollectionItemType; id: string };
  /** `<routeId>.saveSheet`, `.collection.<id>`, `.newName`, `.create`. */
  routeId: string;
};

/**
 * 09 §8.6 "Speichern": which of the member's private collections hold this item. "Gespeichert" comes first and is what a
 * plain save fills; each row toggles at once (light haptic), and a new collection is created with the item already in it.
 * Collections are private: the sheet says so, and nothing here is ever shown to anybody else.
 */
export function SaveSheet({ visible, onClose, item, routeId }: SaveSheetProps) {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const query = useCollections(item, visible);
  const toggle = useToggleCollectionItem();
  const create = useCreateCollection();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const testID = `${routeId}.saveSheet`;

  const flip = (collection: MemberCollection) => {
    haptics.light();
    const add = collection.contains !== true;
    toggle.mutate(
      { collectionId: collection.id, isDefault: collection.is_default, type: item.type, id: item.id, add },
      {
        onError: (error) =>
          toast(error.message || t('collections.failed'), {
            haptic: 'warning',
            testID: `${routeId}.saveToast`,
          }),
      },
    );
  };

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed || create.isPending) return;
    create.mutate(trimmed, {
      onSuccess: (collection) => {
        setName('');
        setCreating(false);
        haptics.light();
        toggle.mutate({
          collectionId: collection.id,
          isDefault: false,
          type: item.type,
          id: item.id,
          add: true,
        });
        toast(t('collections.created', { name: collection.name }), { testID: `${routeId}.saveToast` });
      },
      onError: (error) =>
        toast(error.message || t('collections.failed'), {
          haptic: 'warning',
          testID: `${routeId}.saveToast`,
        }),
    });
  };

  let body;
  if (query.isPending) {
    body = (
      <Skeleton testID={`${testID}.skeleton`}>
        <View style={styles.list}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <View key={index} style={styles.skeletonRow}>
              <SkeletonText variant="body" width="45%" />
              <SkeletonText variant="caption" width="25%" />
            </View>
          ))}
        </View>
      </Skeleton>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${testID}.error`}
      />
    );
  } else {
    const collections = query.data;
    body = (
      <View style={styles.list} role="list">
        {collections.map((collection, index) => (
          <ListRow
            key={collection.id}
            title={collection.name}
            subtitle={t('collections.items', { count: collection.items_count })}
            onPress={() => flip(collection)}
            role="button"
            chevron={false}
            accessibilityTitle={collection.name}
            control={
              <Checkbox
                checked={collection.contains === true}
                onChange={() => flip(collection)}
                label={collection.name}
                testID={`${testID}.collection.${collection.id}.check`}
              />
            }
            inset={space[16]}
            divider={index < collections.length - 1}
            testID={`${testID}.collection.${collection.id}`}
          />
        ))}
      </View>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('collections.title')}
      label={t('collections.title')}
      testID={testID}
    >
      <Text variant="callout" color="text.secondary" style={styles.intro} testID={`${testID}.private`}>
        {t('collections.private')}
      </Text>
      {body}
      {query.isSuccess ? (
        creating ? (
          <View style={styles.create}>
            <TextInput
              label={t('collections.newName')}
              value={name}
              onChangeText={setName}
              maxLength={COLLECTION_NAME_MAX}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              testID={`${testID}.newName`}
            />
            <Button
              label={t('collections.create')}
              variant="secondary"
              size="m"
              onPress={submit}
              disabled={!trimmed}
              loading={create.isPending}
              testID={`${testID}.create`}
            />
          </View>
        ) : (
          <View style={styles.create}>
            <Button
              label={t('collections.new')}
              icon="plus"
              variant="tertiary"
              size="m"
              onPress={() => setCreating(true)}
              testID={`${testID}.new`}
            />
          </View>
        )
      ) : null}
    </Sheet>
  );
}
