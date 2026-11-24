<?php

namespace App\Services\Forum;

use League\CommonMark\Environment\EnvironmentBuilderInterface;
use League\CommonMark\Extension\Autolink\UrlAutolinkParser;
use League\CommonMark\Extension\CommonMark\Delimiter\Processor\EmphasisDelimiterProcessor;
use League\CommonMark\Extension\CommonMark\Parser\Block\ListBlockStartParser;
use League\CommonMark\Extension\CommonMark\Parser\Inline\AutolinkParser;
use League\CommonMark\Extension\CommonMark\Parser\Inline\CloseBracketParser;
use League\CommonMark\Extension\CommonMark\Parser\Inline\EntityParser;
use League\CommonMark\Extension\CommonMark\Parser\Inline\EscapableParser;
use League\CommonMark\Extension\CommonMark\Parser\Inline\OpenBracketParser;
use League\CommonMark\Extension\ConfigurableExtensionInterface;
use League\CommonMark\Parser\Inline\NewlineParser;
use League\Config\ConfigurationBuilderInterface;
use Nette\Schema\Expect;

/**
 * The forum's Markdown subset (ADR-506, m5.8-contract D5): paragraphs, lists, emphasis, strong, links (inline, <autolinks> and bare
 * http(s) addresses) and line breaks. Every other CommonMark construct has no parser here, so headings, code, quotes, images, tables and
 * raw HTML stay literal text. ForumMarkdown walks the tree itself and never uses a CommonMark renderer.
 */
final class ForumMarkdownExtension implements ConfigurableExtensionInterface
{
    public function configureSchema(ConfigurationBuilderInterface $builder): void
    {
        // The schema the list and emphasis parsers read (as CommonMarkCoreExtension defines it).
        $builder->addSchema('commonmark', Expect::structure([
            'use_asterisk' => Expect::bool(true),
            'use_underscore' => Expect::bool(true),
            'enable_strong' => Expect::bool(true),
            'enable_em' => Expect::bool(true),
            'unordered_list_markers' => Expect::listOf('string')->min(1)->default(['*', '+', '-'])->mergeDefaults(false),
        ]));
    }

    public function register(EnvironmentBuilderInterface $environment): void
    {
        $environment
            ->addBlockStartParser(new ListBlockStartParser, 10)
            ->addInlineParser(new NewlineParser, 200)
            ->addInlineParser(new EscapableParser, 80)
            ->addInlineParser(new EntityParser, 70)
            ->addInlineParser(new AutolinkParser, 50)
            ->addInlineParser(new CloseBracketParser, 30)
            ->addInlineParser(new OpenBracketParser, 20)
            ->addInlineParser(new UrlAutolinkParser(['http', 'https'], 'https'), 0)
            ->addDelimiterProcessor(new EmphasisDelimiterProcessor('*'))
            ->addDelimiterProcessor(new EmphasisDelimiterProcessor('_'));
    }
}
