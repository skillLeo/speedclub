import * as WebBrowser from 'expo-web-browser';
import { Link, type Href } from 'expo-router';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { resolveLink, siteUrl } from '@/features/settings/markdown/links';
import { isWeb } from '@/lib/platform';
import { createStyles, type TypeVariant } from '@/theme';
import { Text } from '@/ui/Text';

import { blocksOf, plainTextOf, safeHref, type ForumBlock, type ForumInline } from '../content';

const useStyles = createStyles((t) => ({
  root: { alignSelf: 'stretch', gap: t.space[12] },
  list: { gap: t.space[8] },
  item: { flexDirection: 'row', gap: t.space[8] },
  marker: { minWidth: t.space[16] },
  itemBody: { flex: 1, gap: t.space[8], minWidth: 0 },
  link: { textDecorationLine: 'underline' },
}));

/** The bold twin of a running variant (the 2.0 scale has one for body; callout is Inter 500 already). */
const STRONG: Partial<Record<TypeVariant, TypeVariant>> = { body: 'bodyStrong' };

function openExternal(url: string): void {
  WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}

/** A link's text spans, as inlines (the schema types them as plain text spans). */
type LinkSpan = NonNullable<ForumInline['children']>[number];

function Inlines({ nodes, variant, site, keyPrefix }: { nodes: readonly (ForumInline | LinkSpan)[]; variant: TypeVariant; site: string | null; keyPrefix: string }): ReactNode {
  const styles = useStyles();
  return nodes.map((node, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (node.type) {
      case 'break':
        return <Fragment key={key}>{'\n'}</Fragment>;
      case 'text':
        // The fonts ship no italic: emphasis reads as running text rather than a faked slant (as the legal texts, SET-18).
        return node.bold ? (
          <Text key={key} variant={STRONG[variant] ?? variant}>
            {node.text ?? ''}
          </Text>
        ) : (
          <Fragment key={key}>{node.text ?? ''}</Fragment>
        );
      case 'link': {
        // The legal renderer's link rules (links.ts): a link to one of the app's own screens opens inside the app, http(s) outside it,
        // anything else stays text. The server already allows only http and https (m5.8-contract D5); safeHref checks it again.
        const href = safeHref(node.href);
        const spans: readonly LinkSpan[] = node.children && node.children.length > 0 ? node.children : [{ type: 'text', text: node.href ?? '', bold: false, italic: false }];
        const target = href ? resolveLink(href, site) : null;
        const children = <Inlines nodes={spans} variant={variant} site={site} keyPrefix={key} />;
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
        return (
          <Text
            key={key}
            variant={variant}
            role="link"
            style={styles.link}
            // Web: a real anchor in a new tab (user-generated: nofollow ugc). Native: the in-app browser.
            {...(isWeb
              ? ({ href: target.url, hrefAttrs: { target: '_blank', rel: 'nofollow ugc noopener noreferrer' } } as object)
              : { onPress: () => openExternal(target.url) })}
          >
            {children}
          </Text>
        );
      }
    }
  });
}

function Blocks({ blocks, variant, site, keyPrefix }: { blocks: readonly ForumBlock[]; variant: TypeVariant; site: string | null; keyPrefix: string }): ReactNode {
  const styles = useStyles();
  return blocks.map((block, index) => {
    const key = `${keyPrefix}.${index}`;
    if (block.type === 'paragraph') {
      return (
        <Text key={key} variant={variant} selectable>
          <Inlines nodes={block.children ?? []} variant={variant} site={site} keyPrefix={key} />
        </Text>
      );
    }
    const first = block.start ?? 1;
    return (
      <View key={key} role="list" style={styles.list}>
        {(block.items ?? []).map((item, position) => (
          <View key={`${key}.${position}`} role="listitem" style={styles.item} aria-label={plainTextOf(blocksOf(item))}>
            <Text variant={variant} numeric={block.ordered} style={styles.marker} aria-hidden>
              {block.ordered ? `${first + position}.` : '•'}
            </Text>
            <View style={styles.itemBody}>
              <Blocks blocks={blocksOf(item)} variant={variant} site={site} keyPrefix={`${key}.${position}`} />
            </View>
          </View>
        ))}
      </View>
    );
  });
}

export type ForumContentProps = {
  blocks: readonly ForumBlock[];
  /** `body` for the opening post, `callout` for replies (both have a strong twin or are already medium). */
  variant?: 'body' | 'callout';
  testID?: string;
};

/**
 * A forum post's text (m5.8-contract D5), drawn natively from the server's tree: paragraphs, lists (nested), bold, links. Never HTML,
 * never a WebView; links follow the same safety rules as the legal texts.
 */
export function ForumContent({ blocks, variant = 'body', testID }: ForumContentProps) {
  const styles = useStyles();
  const site = useMemo(() => siteUrl(), []);
  return (
    <View style={styles.root} testID={testID}>
      <Blocks blocks={blocks} variant={variant} site={site} keyPrefix="b" />
    </View>
  );
}
