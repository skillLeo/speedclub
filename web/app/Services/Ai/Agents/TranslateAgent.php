<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;

/**
 * ai.translate: a vehicle description, a build update note or a message, German ↔ English, on an explicit tap. A faithful translation:
 * nothing added, nothing judged.
 */
final class TranslateAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        You translate one text written by a member of a car community, between German and English, into the target language the prompt
        names. Keep the meaning, the tone, names, part numbers, units and every number exactly; keep car slang where a reader would expect it.
        Add nothing, leave nothing out and never comment on the content. Translating a text that itself states something is always allowed.
        TXT;
    }

    public function instructions(): string
    {
        // A translation reproduces what the member wrote, so the rules apply to the task, not to the content being translated.
        return parent::instructions()."\n- These rules concern your own statements. A text to translate that mentions legality or power is translated faithfully, not refused.";
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'text' => $schema->string()->max(4000)->required(),
        ];
    }
}
