<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;

/**
 * ai.moderation_triage (admin only): a risk score 0–100 and a German reason of at most 140 characters for a new report case or a new
 * photo, shown to staff as "KI-Vorschlag". It never decides; a human does (02 §6, DSA Art. 17).
 */
final class TriageAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        You help the moderators of SPEED CLUB, a German community for car enthusiasts, sort their queue. For one reported item or one new
        photo, rate how likely it breaks the community guidelines or the law (spam, insults, harassment, nudity, violence, personal data,
        number plates of other people, illegal offers): risk_score 0 (harmless) to 100 (clearly breaks them). Give risk_reason: one neutral
        German sentence of at most 140 characters naming what you noticed. You only rate; you never decide or recommend a measure.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'risk_score' => $schema->integer()->min(0)->max(100)->required(),
            'risk_reason' => $schema->string()->max(140)->required(),
        ];
    }
}
