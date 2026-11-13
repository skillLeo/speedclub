import * as WebBrowser from 'expo-web-browser';
import { Link, type Href } from 'expo-router';
import { Fragment, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, type TypeVariant } from '@/theme';
import { Hairline, Text } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';

import { resolveLink, siteUrl } from './links';
import { plainText, type MdBlock, type MdHeadingLevel, type MdInline } from './parse';

const useStyles = createStyles((t) => ({
  root: { alignSelf: 'stretch' },
  sectionHeading: { marginTop: t.space[32] },
  subHeading: { marginTop: t.space[24] },
  afterHeading: { marginTop: t.space[12] },
  block: { marginTop: t.space[16] },
  first: { marginTop: 0 },
  list: { gap: t.space[8] },
  item: { flexDirection: 'row', gap: t.space[8] },
  marker: { minWidth: t.space[16] },
  itemText: { flex: 1, minWidth: 0 },
  link: { textDecorationLine: 'underline' },
  placeholder: { backgroundColor: t.color.bg.raised },
  code: { backgroundColor: t.color.bg.raised, borderRadius: t.radius.sm, padding: t.space[12] },
  table: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden', paddingHorizontal: t.space[16] },
  pair: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[16], paddingVertical: t.space[12] },
  pairStacked: { gap: t.space[2], paddingVertical: t.space[12] },
  pairLabel: { flex: 1, minWidth: 0 },
  pairValue: { flexShrink: 1, maxWidth: '50%', textAlign: 'right' },
  pairValueStacked: { textAlign: 'left' },
  record: { gap: t.space[12], paddingVertical: t.space[16] },
  field: { gap: t.space[2] },
}));

const HEADING_VARIANT: Record<MdHeadingLevel, TypeVariant> = {
  1: 'title2',
  2: 'headline',
  3: 'headline',
  4: 'bodyStrong',
  5: 'bodyStrong',
  6: 'bodyStrong',
};

/**
 * The bold face of a running variant, at the same size and line height. The 2.0 scale has a strong twin only for body;
 * callout is already Inter 500 and stays as it is.
 */
const STRONG_VARIANT: Partial<Record<TypeVariant, TypeVariant>> = { body: 'bodyStrong' };

function openExternal(url: string): void {
  if (url.startsWith('mailto:')) {
    Linking.openURL(url).catch(() => undefined);
    return;
  }
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}

type InlineProps = { nodes: readonly MdInline[]; variant: TypeVariant; site: string | null; keyPrefix: string };

/** Inline nodes as nested Text. A link whose target fails validation keeps its text and loses the link. */
function Inlines({ nodes, variant, site, keyPrefix }: InlineProps): ReactNode {
  const styles = useStyles();
  const { t } = useTranslation('settings');
  return nodes.map((node, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.text}</Fragment>;
      case 'break':
        return <Fragment key={key}>{'\n'}</Fragment>;
      case 'placeholder':
        return (
          // DQ-222: hyphenated like the text around it. A long placeholder would otherwise break inside a word without a hyphen.
          <Text key={key} variant={variant} color="text.secondary" style={styles.placeholder}>
            {node.text}
          </Text>
        );
      case 'emphasis':
        // The fonts ship no italic: emphasis reads as running text rather than a faked slant.
        return <Inlines key={key} nodes={node.children} variant={variant} site={site} keyPrefix={key} />;
      case 'strong':
        return (
          <Text key={key} variant={STRONG_VARIANT[variant] ?? variant}>
            <Inlines nodes={node.children} variant={STRONG_VARIANT[variant] ?? variant} site={site} keyPrefix={key} />
          </Text>
        );
      case 'link': {
        const target = resolveLink(node.href, site);
        const children = <Inlines nodes={node.children} variant={variant} site={site} keyPrefix={key} />;
        if (!target) return <Fragment key={key}>{children}</Fragment>;
        if (target.kind === 'internal') {
          return (
            <Link key={key} href={target.path as Href} asChild>
              <Text variant={variant} role="link" style={styles.link}>
                {children}
              </Text>
            </Link>
          );
        }
        const external = !target.url.startsWith('mailto:');
        const label = external ? t('legal.externalLink', { text: plainText(node.children) }) : undefined;
        return (
          <Text
            key={key}
            variant={variant}
            role="link"
            aria-label={label}
            style={styles.link}
            // Web: a real anchor in a new tab, which the browser opens itself. Native: the in-app browser or the mail app.
            {...(isWeb
              ? ({ href: target.url, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } as object)
              : { onPress: () => openExternal(target.url) })}
          >
            {children}
          </Text>
        );
      }
    }
  });
}

function spacingFor(block: MdBlock, previous: MdBlock | undefined, styles: ReturnType<typeof useStyles>) {
  if (!previous) return styles.first;
  if (block.type === 'heading') return block.level <= 2 ? styles.sectionHeading : styles.subHeading;
  if (previous.type === 'heading') return styles.afterHeading;
  return styles.block;
}

function Table({ block, site, keyPrefix }: { block: Extract<MdBlock, { type: 'table' }>; site: string | null; keyPrefix: string }) {
  const styles = useStyles();
  const stacked = useStacksAtFontScale();
  const pairs = block.header.length === 2;
  const rows = pairs ? [block.header, ...block.rows] : block.rows;
  return (
    <View style={styles.table}>
      {rows.map((row, rowIndex) => {
        const rowKey = `${keyPrefix}.${rowIndex}`;
        const divider = rowIndex < rows.length - 1 ? <Hairline /> : null;
        if (pairs) {
          const header = rowIndex === 0;
          return (
            <View key={rowKey}>
              <View style={stacked ? styles.pairStacked : styles.pair}>
                {/* The first column names the row, as public.css has it and as the record tables below do. */}
                <Text variant={header ? 'callout' : 'bodyStrong'} color={header ? 'text.secondary' : 'text.primary'} style={styles.pairLabel} selectable>
                  <Inlines nodes={row[0] ?? []} variant={header ? 'callout' : 'bodyStrong'} site={site} keyPrefix={`${rowKey}.0`} />
                </Text>
                <Text
                  variant="callout"
                  color={header ? 'text.secondary' : 'text.primary'}
                  style={[styles.pairValue, stacked ? styles.pairValueStacked : null]}
                  selectable
                >
                  <Inlines nodes={row[1] ?? []} variant="callout" site={site} keyPrefix={`${rowKey}.1`} />
                </Text>
              </View>
              {divider}
            </View>
          );
        }
        return (
          <View key={rowKey}>
            <View style={styles.record}>
              <Text variant="bodyStrong" selectable>
                <Inlines nodes={row[0] ?? []} variant="bodyStrong" site={site} keyPrefix={`${rowKey}.0`} />
              </Text>
              {row.slice(1).map((cell, cellIndex) => (
                <View key={`${rowKey}.${cellIndex + 1}`} style={styles.field}>
                  <Text variant="callout" color="text.secondary">
                    {plainText(block.header[cellIndex + 1] ?? [])}
                  </Text>
                  <Text variant="callout" selectable>
                    <Inlines nodes={cell} variant="callout" site={site} keyPrefix={`${rowKey}.${cellIndex + 1}`} />
                  </Text>
                </View>
              ))}
            </View>
            {divider}
          </View>
        );
      })}
    </View>
  );
}

function Block({ block, site, keyPrefix }: { block: MdBlock; site: string | null; keyPrefix: string }) {
  const styles = useStyles();
  switch (block.type) {
    case 'heading':
      return (
        <Text variant={HEADING_VARIANT[block.level]} role="heading" {...({ 'aria-level': Math.min(block.level, 4) } as object)}>
          <Inlines nodes={block.children} variant={HEADING_VARIANT[block.level]} site={site} keyPrefix={keyPrefix} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text variant="body" selectable>
          <Inlines nodes={block.children} variant="body" site={site} keyPrefix={keyPrefix} />
        </Text>
      );
    case 'list':
      return (
        <View role="list" style={styles.list}>
          {block.items.map((item, index) => (
            <View key={`${keyPrefix}.${index}`} role="listitem" style={styles.item}>
              <Text variant="body" color="text.secondary" aria-hidden style={styles.marker}>
                {block.ordered ? `${block.start + index}.` : '•'}
              </Text>
              <Text variant="body" selectable style={styles.itemText}>
                <Inlines nodes={item} variant="body" site={site} keyPrefix={`${keyPrefix}.${index}`} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'table':
      return <Table block={block} site={site} keyPrefix={keyPrefix} />;
    case 'code':
      return (
        <View style={styles.code}>
          <Text variant="body" selectable hyphenate={false}>
            {block.text}
          </Text>
        </View>
      );
    case 'rule':
      return <Hairline />;
  }
}

export type MarkdownProps = {
  blocks: readonly MdBlock[];
  /** The block a link into the text should land on (SET-18 `?section=`): its top, from the top of this text, comes back here. */
  anchor?: { index: number; onLayout: (y: number) => void };
  testID?: string;
};

/** Renders parsed Markdown through Text primitives only: there is no path from the source to markup. */
export function Markdown({ blocks, anchor, testID }: MarkdownProps) {
  const styles = useStyles();
  const site = useMemo(() => siteUrl(), []);
  return (
    <View style={styles.root} testID={testID}>
      {blocks.map((block, index) => (
        <View
          key={index}
          style={spacingFor(block, blocks[index - 1], styles)}
          onLayout={anchor?.index === index ? (event) => anchor.onLayout(event.nativeEvent.layout.y) : undefined}
        >
          <Block block={block} site={site} keyPrefix={String(index)} />
        </View>
      ))}
    </View>
  );
}
