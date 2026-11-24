<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Attributes\CacheInstructions;

/**
 * ai.forum_summary (10 §8.4, m5.9-contract §2.3): three short German lines on what a long forum thread is about and where it stands. The
 * prompt holds the title and the public text of its posts without names, mentions, links or photos; the server drops a line with a name,
 * a link or a number that is not in the posts (ForumSummaries).
 */
#[CacheInstructions]
final class ForumSummaryAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        Summarise a discussion thread of a German car community forum for readers who arrive late. Write exactly three short German lines
        (each at most 140 characters): what the question or topic is, what the replies mostly say or recommend, and where it stands (for
        example solved, open, opinions differ). Neutral, factual, no names, no quotes, no links, no numbers that are not in the posts, no
        advice of your own and no statement about whether a modification is legal.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'lines' => $schema->array()->max(3)->items($schema->string()->max(140))->required(),
        ];
    }
}
