import { forwardRef, type ComponentRef } from 'react';
import type { View } from 'react-native';

import type { PlacedCard, WrappedPayload } from '@/api/queries/wrapped';

import { IntroCard } from './IntroCard';
import { PercentileCard } from './PercentileCard';
import { ScansCard } from './ScansCard';
import { ScoreCard } from './ScoreCard';
import { ShareCard } from './ShareCard';
import { SpiritCard } from './SpiritCard';
import { SpotsCard } from './SpotsCard';
import { TopModCard } from './TopModCard';
import { TreffenCard } from './TreffenCard';

export type WrappedCardViewProps = {
  placed: PlacedCard;
  payload: WrappedPayload;
  qrSvg: string | null;
  width: number;
  height: number;
  /** `WRP-01.card` → `WRP-01.card.<kind>` */
  testID: string;
};

/** One card of the story by its kind; the ref is the frame view-shot draws. */
export const WrappedCardView = forwardRef<ComponentRef<typeof View>, WrappedCardViewProps>(function WrappedCardView({ placed, payload, qrSvg, width, height, testID }, ref) {
  const { card } = placed;
  const common = { payload, width, height, testID: `${testID}.${card.kind}`, ref };
  switch (card.kind) {
    case 'intro':
      return <IntroCard card={card} {...common} />;
    case 'spots':
      return <SpotsCard card={card} {...common} />;
    case 'scans':
      return <ScansCard card={card} {...common} />;
    case 'score':
      return <ScoreCard card={card} {...common} />;
    case 'top_mod':
      return <TopModCard card={card} {...common} />;
    case 'treffen':
      return <TreffenCard card={card} {...common} />;
    case 'build_spirit':
      return <SpiritCard card={card} {...common} />;
    case 'percentile':
      return <PercentileCard card={card} {...common} />;
    case 'share':
      return <ShareCard card={card} qrSvg={qrSvg} {...common} />;
  }
});
