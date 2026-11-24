import { useTranslation } from 'react-i18next';

import type { CommentTarget } from '@/api/queries/social2';
import { useReport } from '@/features/safety/useReport';
import { CommentsSheet } from '@/features/updates/components/Comments';
import { motionDuration } from '@/ui/motion';

export type FeedCommentsProps = {
  visible: boolean;
  onClose: () => void;
  /** R5-5: the update's thread (an update card), or the car's own (a car card, VEH-01). */
  target: CommentTarget;
  /** The car the thread belongs to: the sheet's accessible name ("Kommentare zu BMW M3 (E46)"). */
  vehicleTitle: string;
  /** The owner may delete any comment there and reports none of them. */
  own: boolean;
  /** The owner switched comments off: the thread stays readable, the composer says why it is closed. */
  enabledByOwner?: boolean;
  /** R5-5: the car thread's `comment_thread.can_write` (a member who may not write reads the restricted line). */
  canWrite?: boolean;
  routeId: string;
};

/**
 * R4-2.2, R5-5: a feed card's comments sheet (the update's thread, or the car's own) with its report flow, also VEH-01's. Mounted from the card's first "Kommentare" on (the report sheet outlives
 * the comments sheet): "Melden" closes the comments first, so only one sheet is ever open.
 */
export function FeedComments({ visible, onClose, target, vehicleTitle, own, enabledByOwner = true, canWrite, routeId }: FeedCommentsProps) {
  const { t } = useTranslation('home');
  const report = useReport(null, { routeId });
  const testID = `${routeId}.comments.${target.id}`;
  return (
    <>
      <CommentsSheet
        visible={visible}
        onClose={onClose}
        target={target}
        enabledByOwner={enabledByOwner}
        canWrite={canWrite}
        label={t('actions.commentsOf', { vehicle: vehicleTitle })}
        // R4DQ-14, R5DQ-06: the head names the car on its own line, in the car-name voice, never hyphenated.
        vehicleTitle={vehicleTitle}
        onReport={(target) => {
          onClose();
          // The report sheet opens once the comments sheet has left (one modal at a time on iOS).
          setTimeout(() => report.openFor(target), motionDuration('spring.default'));
        }}
        reportable={report.available && !own}
        testID={testID}
      />
      {report.element}
    </>
  );
}
