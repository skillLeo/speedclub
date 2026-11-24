<?php

namespace App\Services\Forum;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\Node\Block\ListBlock;
use League\CommonMark\Extension\CommonMark\Node\Block\ListItem;
use League\CommonMark\Extension\CommonMark\Node\Inline\Emphasis;
use League\CommonMark\Extension\CommonMark\Node\Inline\Link;
use League\CommonMark\Extension\CommonMark\Node\Inline\Strong;
use League\CommonMark\Node\Block\Paragraph;
use League\CommonMark\Node\Inline\AbstractStringContainer;
use League\CommonMark\Node\Inline\Newline;
use League\CommonMark\Node\Node;
use League\CommonMark\Parser\MarkdownParser;

/**
 * The forum's Markdown subset (ADR-506, m5.8-contract D5) as a tree the app renders natively (`content`) and as sanitised HTML for the
 * admin. The parser knows only paragraphs, lists, bold, italic, links and breaks (ForumMarkdownExtension); everything else is text.
 * Links keep http and https only (any other scheme becomes its text). The HTML is written from the tree with every text and address
 * escaped, so nothing a member typed can become markup; links carry rel="nofollow ugc noopener noreferrer".
 *
 * Block: {type: paragraph, children: Inline[]} | {type: list, ordered: bool, start: int|null, items: Block[][]}.
 * Inline: {type: text, text, bold, italic} | {type: link, href, children: Inline[]} | {type: break}.
 *
 * @phpstan-type Inline array<string, mixed>
 * @phpstan-type Block array<string, mixed>
 */
final class ForumMarkdown
{
    private const REL = 'nofollow ugc noopener noreferrer';

    private ?MarkdownParser $parser = null;

    /**
     * @return list<Block>
     */
    public function blocks(?string $markdown): array
    {
        $source = trim(str_replace(["\r\n", "\r"], "\n", (string) $markdown));

        if ($source === '') {
            return [];
        }

        return $this->blockList($this->parser()->parse($source));
    }

    public function html(?string $markdown): string
    {
        return $this->renderBlocks($this->blocks($markdown));
    }

    /**
     * The text without markup, one space between blocks (search keys, admin rows, excerpts).
     */
    public function plain(?string $markdown, int $limit = 0): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', $this->plainBlocks($this->blocks($markdown))));

        return $limit > 0 ? mb_strimwidth($text, 0, $limit, '…') : $text;
    }

    private function parser(): MarkdownParser
    {
        if ($this->parser === null) {
            $environment = new Environment(['max_nesting_level' => 8, 'max_delimiters_per_line' => 200]);
            $environment->addExtension(new ForumMarkdownExtension);
            $this->parser = new MarkdownParser($environment);
        }

        return $this->parser;
    }

    /**
     * @return list<Block>
     */
    private function blockList(Node $parent): array
    {
        $blocks = [];

        foreach ($parent->children() as $child) {
            if ($child instanceof ListBlock) {
                $items = [];

                foreach ($child->children() as $item) {
                    if ($item instanceof ListItem) {
                        $items[] = $this->blockList($item);
                    }
                }

                $data = $child->getListData();
                $ordered = $data->type === ListBlock::TYPE_ORDERED;
                $blocks[] = ['type' => 'list', 'ordered' => $ordered, 'start' => $ordered ? ($data->start ?? 1) : null, 'items' => $items];

                continue;
            }

            $inlines = $this->inlines($child, false, false);

            if ($child instanceof Paragraph || $inlines !== []) {
                $blocks[] = ['type' => 'paragraph', 'children' => $inlines];
            }
        }

        return $blocks;
    }

    /**
     * @return list<Inline>
     */
    private function inlines(Node $parent, bool $bold, bool $italic): array
    {
        $out = [];

        foreach ($parent->children() as $node) {
            $parts = match (true) {
                $node instanceof Strong => $this->inlines($node, true, $italic),
                $node instanceof Emphasis => $this->inlines($node, $bold, true),
                $node instanceof Link => $this->link($node, $bold, $italic),
                // A single line break counts as one: members write lines, not CommonMark paragraphs.
                $node instanceof Newline => [['type' => 'break']],
                $node instanceof AbstractStringContainer => [['type' => 'text', 'text' => $node->getLiteral(), 'bold' => $bold, 'italic' => $italic]],
                default => $this->inlines($node, $bold, $italic),
            };

            foreach ($parts as $part) {
                $last = $out === [] ? null : $out[array_key_last($out)];

                if ($part['type'] === 'text' && $last !== null && $last['type'] === 'text'
                    && ($last['bold'] ?? false) === ($part['bold'] ?? false) && ($last['italic'] ?? false) === ($part['italic'] ?? false)) {
                    $out[array_key_last($out)]['text'] = ($last['text'] ?? '').($part['text'] ?? '');

                    continue;
                }

                $out[] = $part;
            }
        }

        return $out;
    }

    /**
     * @return list<Inline>
     */
    private function link(Link $link, bool $bold, bool $italic): array
    {
        $children = $this->inlines($link, $bold, $italic);
        $href = self::safeUrl($link->getUrl());

        if ($href === null) {
            return $children;
        }

        return [['type' => 'link', 'href' => $href, 'children' => $children === [] ? [['type' => 'text', 'text' => $href, 'bold' => $bold, 'italic' => $italic]] : $children]];
    }

    /**
     * http and https addresses with a host, at most 2000 characters; anything else is no link.
     */
    public static function safeUrl(string $url): ?string
    {
        $url = trim($url);

        if ($url === '' || strlen($url) > 2000 || preg_match('~\Ahttps?://[^\s/?#@]+~i', $url) !== 1 || preg_match('/[\x00-\x1F\x7F]/', $url) === 1) {
            return null;
        }

        return $url;
    }

    /**
     * @param  list<Block>  $blocks
     */
    private function renderBlocks(array $blocks): string
    {
        $html = '';

        foreach ($blocks as $block) {
            if ($block['type'] === 'list') {
                $tag = $block['ordered'] === true ? 'ol' : 'ul';
                $start = $block['ordered'] === true && is_int($block['start'] ?? null) && $block['start'] !== 1 ? ' start="'.$block['start'].'"' : '';
                $items = '';

                foreach ((array) $block['items'] as $item) {
                    /** @var list<Block> $item */
                    $items .= '<li>'.$this->renderBlocks($item).'</li>';
                }

                $html .= "<$tag$start>$items</$tag>";

                continue;
            }

            /** @var list<Inline> $children */
            $children = $block['children'] ?? [];
            $html .= '<p>'.$this->renderInlines($children).'</p>';
        }

        return $html;
    }

    /**
     * @param  list<Inline>  $inlines
     */
    private function renderInlines(array $inlines): string
    {
        $html = '';

        foreach ($inlines as $inline) {
            $html .= match ($inline['type']) {
                'break' => '<br>',
                'link' => '<a href="'.e((string) ($inline['href'] ?? '')).'" rel="'.self::REL.'" target="_blank">'.$this->renderInlines(self::children($inline)).'</a>',
                default => self::styled(e((string) ($inline['text'] ?? '')), ($inline['bold'] ?? false) === true, ($inline['italic'] ?? false) === true),
            };
        }

        return $html;
    }

    /**
     * The inlines of a link.
     *
     * @param  Inline  $inline
     * @return list<Inline>
     */
    private static function children(array $inline): array
    {
        $children = $inline['children'] ?? [];

        return is_array($children) ? array_values(array_filter($children, is_array(...))) : [];
    }

    private static function styled(string $text, bool $bold, bool $italic): string
    {
        $text = $italic ? "<em>$text</em>" : $text;

        return $bold ? "<strong>$text</strong>" : $text;
    }

    /**
     * @param  list<Block>  $blocks
     */
    private function plainBlocks(array $blocks): string
    {
        $text = '';

        foreach ($blocks as $block) {
            if ($block['type'] === 'list') {
                foreach ((array) $block['items'] as $item) {
                    /** @var list<Block> $item */
                    $text .= ' '.$this->plainBlocks($item);
                }

                continue;
            }

            /** @var list<Inline> $children */
            $children = $block['children'] ?? [];
            $text .= ' '.$this->plainInlines($children);
        }

        return $text;
    }

    /**
     * @param  list<Inline>  $inlines
     */
    private function plainInlines(array $inlines): string
    {
        $text = '';

        foreach ($inlines as $inline) {
            $text .= match ($inline['type']) {
                'break' => ' ',
                'link' => $this->plainInlines(self::children($inline)),
                default => (string) ($inline['text'] ?? ''),
            };
        }

        return $text;
    }
}
