<?php

namespace App\Services\System;

use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Promptable;

/**
 * ADM-50 "KI testen": one short prompt to the configured provider (RunTestAiCall). No member data ever goes into it.
 */
final class SystemTestAgent implements Agent
{
    use Promptable;

    public function instructions(): string
    {
        return 'You are a connectivity check. Answer with the single word OK.';
    }
}
