<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Ai\Attributes\CacheInstructions;

/**
 * ai.product_match (10 §8.2, m5.9-contract §2.2): what a member typed for a part ("kw v3") as the brand and the product words a catalogue
 * would use ("KW", ["Variant", "3"]). It names no product of its own: the server searches the catalogue with these words and answers only
 * catalogue products (MatchProduct).
 */
#[CacheInstructions]
final class ProductNormaliseAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        A member of a German car community typed a short, often abbreviated name of an aftermarket car part. Return the manufacturer's brand
        as it is officially written and up to four words of the official product or product line name, expanding common abbreviations
        (for example "kw v3" → brand "KW", terms ["Variant", "3"]; "bc br" → brand "BC Racing", terms ["BR"]). Use only what the text means;
        if the text names no recognisable part, return an empty brand and no terms. No prices, no opinions, no legality statements.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'brand' => $schema->string()->max(60)->required(),
            'terms' => $schema->array()->max(4)->items($schema->string()->max(30))->required(),
        ];
    }
}
