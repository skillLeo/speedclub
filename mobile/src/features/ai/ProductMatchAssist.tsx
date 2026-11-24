import '@/features/parts/i18n';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AI_FLAGS, AI_PRODUCT_TEXT_MIN, useMatchProduct, type ProductMatch } from '@/api/queries/ai';
import type { ProductRowData } from '@/api/queries/parts';
import { categoryIcon } from '@/features/vehicle/model';
import { useOnline } from '@/state/online';
import { createStyles, space } from '@/theme';
import { Button } from '@/ui/Button';
import { ProductRow } from '@/ui/ProductRow';
import { Text } from '@/ui/Text';
import { nameInText } from '@/ui/textBreaks';

import { AiLabel } from './AiLabel';
import { AiNote } from './AiNote';
import { quietAiNote, recordAiFailure, useAiAvailable, useAiDayEnd, type QuietAiNote } from './availability';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  head: { alignItems: 'baseline', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[2] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

export type ProductMatchAssistProps = {
  /** What the member typed and the catalogue search found nothing for. */
  text: string;
  /** The mod's category, which narrows the products. */
  category: string | null;
  onChoose: (product: ProductRowData) => void;
  disabled?: boolean;
  testID: string;
};

/**
 * GAR-10 "Produkt" when the catalogue search found nothing (M5.9 `ai.product_match` + `parts_catalogue`, 10 §8.2; flag + "KI-Vorschläge"):
 * "Im Katalog suchen · KI-Vorschlag" asks the server, which matches the words first and lets the AI only turn the text into catalogue
 * terms ("kw v3" → "KW Variant 3"). It answers catalogue products only, at most three; a pick links the mod as any product does.
 * Nothing found: the sheet's "nothing in the catalogue" line stays, and the note names the next step (brand and model in the form). Label text only, no icon (10 §8).
 */
export function ProductMatchAssist({ text, category, onChoose, disabled = false, testID }: ProductMatchAssistProps) {
  const { t } = useTranslation('parts');
  const common = useTranslation('common').t;
  const styles = useStyles();
  const online = useOnline();
  const available = useAiAvailable(AI_FLAGS.productMatch);
  const dayEnd = useAiDayEnd(AI_FLAGS.productMatch);
  const match = useMatchProduct();
  const [answer, setAnswer] = useState<ProductMatch | null>(null);
  const [note, setNote] = useState<QuietAiNote | null>(null);
  const [hidden, setHidden] = useState(false);
  if (!available || hidden || text.trim().length < AI_PRODUCT_TEXT_MIN) return null;

  const run = () => {
    setNote(null);
    match.mutate(
      { text, categoryKey: category },
      {
        onSuccess: (next) => {
          setAnswer(next);
          // DQ-P5-060 b: no product: say what to do instead, not a second "nothing".
          if (next.products.length === 0) setNote({ text: t('editor.matchNone'), verify: false, retry: false });
        },
        onError: (error) => {
          recordAiFailure(AI_FLAGS.productMatch, error);
          const quiet = quietAiNote(common, error);
          if (quiet === null) setHidden(true);
          else setNote(quiet);
        },
      },
    );
  };

  const products = answer?.products ?? [];
  const shownNote = dayEnd ? { ...dayEnd, retry: false } : note;
  const canAsk = dayEnd === null && answer === null && (note === null || note.retry);

  return (
    <View style={styles.root} testID={testID}>
      {products.length > 0 ? (
        <>
          <View style={styles.head}>
            <Text hyphenate={false} variant="calloutStrong" role="heading" {...({ 'aria-level': 3 } as object)} testID={`${testID}.title`}>
              {/* DQ-P5-068: the product name's short last token ("3" of "KW Variante 3") stays with the word before it; a product name
                  is never hyphenated ("Varian-te" at 200 %). */}
              {answer?.normalized ? t('editor.matchFound', { name: nameInText(answer.normalized) }) : t('editor.matchFoundPlain')}
            </Text>
            {answer?.label ? <AiLabel label={answer.label} testID={`${testID}.label`} /> : null}
          </View>
          <View style={styles.list} role="list">
            {products.map((product, index) => (
              <View key={product.id} role="listitem">
                <ProductRow
                  icon={categoryIcon(product.category.icon)}
                  brand={product.brand.name}
                  name={product.name}
                  category={product.line ?? product.category.name}
                  onPress={() => onChoose(product)}
                  divider={index < products.length - 1}
                  inset={space[16]}
                  testID={`${testID}.product.${product.id}`}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
      {canAsk ? (
        <View style={styles.head}>
          <Button
            label={note?.retry ? t('editor.matchRetry') : t('editor.matchAction')}
            variant="tertiary"
            size="m"
            flush="start"
            disabled={disabled || !online}
            loading={match.isPending}
            onPress={run}
            testID={`${testID}.action`}
          />
          <AiLabel label={t('editor.matchLabel')} testID={`${testID}.actionLabel`} />
        </View>
      ) : null}
      {shownNote ? <AiNote note={shownNote} variant="callout" testID={testID} /> : null}
    </View>
  );
}
