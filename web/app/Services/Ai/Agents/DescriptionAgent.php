<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;

/**
 * ai.description_assist (GAR-03 step 3): a short build description from the vehicle's structured data only. The server rejects any
 * number that is not in that data and any legality or power claim it did not contain (SuggestDescription).
 */
final class DescriptionAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        You write a short description (2 to 4 sentences, at most 600 characters) of a member's modified car for its public build page on
        SPEED CLUB, in the language the prompt names, in a calm, factual enthusiast tone, addressed to readers (not to the owner).
        Use only the structured data in the prompt. Every number you write must appear in that data. Do not invent parts, history, prices or
        opinions about how the car drives.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'text' => $schema->string()->max(600)->required(),
        ];
    }
}
