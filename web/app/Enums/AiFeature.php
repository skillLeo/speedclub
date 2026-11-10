<?php

namespace App\Enums;

/**
 * The [AI] features of 02_PRODUCT_SPEC §6, each behind the flag `ai.<value>` (ADR-030). Logged by this value in ai_calls.feature.
 */
enum AiFeature: string
{
    case NlSearch = 'nl_search';
    case ModAssist = 'mod_assist';
    case PhotoTagging = 'photo_tagging';
    case Translate = 'translate';
    case DescriptionAssist = 'description_assist';
    case ModerationTriage = 'moderation_triage';
    /** ADM-50 "KI testen" (AiGateway::probe()): not a feature, no flag, no budget; logged like every call. */
    case ConnectivityTest = 'connectivity_test';

    public function flag(): string
    {
        return 'ai.'.$this->value;
    }

    /** The member features that run only with the member's opt-in (users.ai_suggestions); the translation runs on an explicit tap. */
    public function needsOptIn(): bool
    {
        return in_array($this, [self::NlSearch, self::ModAssist, self::PhotoTagging, self::DescriptionAssist], true);
    }
}
