import { memo } from 'react';

import type { BuildUpdateRowData } from '@/api/queries/home';
import { photoFields } from '@/features/profile/media';
import { keepNameTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { size } from '@/theme';
import { BuildUpdateRow } from '@/ui';
import type { RowInset } from '@/ui/rowParts';

import { updateMeta } from '../model';

export type UpdateRowProps = {
  update: BuildUpdateRowData;
  onOpen: (update: BuildUpdateRowData) => void;
  divider?: boolean;
  inset?: RowInset;
  testID: string;
};

/**
 * §8 build-update row of Home: the cover as the 56 thumb, the kind of change ("Fahrwerk geändert"), the diff and "BMW M4 Competition ·
 * @jann.ptrs · vor 2 Std.". The vehicle names the change, as the thumb alone does not say whose car it is. Opens the Verlauf entry.
 */
export const UpdateRow = memo(function UpdateRow({ update, onOpen, divider = true, inset, testID }: UpdateRowProps) {
  const format = useFormat();
  const summary = update.summary.trim();
  return (
    <BuildUpdateRow
      title={update.type_label.trim() || keepNameTogether(update.vehicle.full_title)}
      diff={summary || undefined}
      meta={updateMeta(update, format.relative)}
      photo={photoFields(update.vehicle.cover, size.thumb.row)}
      onPress={() => onOpen(update)}
      divider={divider}
      inset={inset}
      testID={testID}
    />
  );
});
