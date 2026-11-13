<?php

namespace App\Enums;

/**
 * users.onboarding_state. A passwordless account (e-mail code, Apple, Google) starts pending_terms and may create nothing until AUTH-09b
 * (POST me/onboarding/accept) stores the accepted versions and the age confirmation (09 §8.1). Null: nothing pending.
 */
enum OnboardingState: string
{
    case PendingTerms = 'pending_terms';
}
