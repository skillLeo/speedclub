<?php

namespace App\Services\Ai;

use App\Enums\AiOutcome;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;

/**
 * An [AI] call that gave nothing to show: the provider failed or timed out (503 ai_unavailable), the feature's daily budget is spent
 * (503 ai_budget_exhausted), the model declined the request as outside what the feature may do (422 ai_refused, 02 §6 "Never"), or a
 * post-check rejected the answer (422 ai_unverifiable). Renders as the API's {message, code, errors}; the triage jobs catch it.
 */
final class AiFailed extends ApiException
{
    public function __construct(ErrorCode $code, public readonly ?AiOutcome $outcome = null)
    {
        parent::__construct($code);
    }

    public static function unavailable(AiOutcome $outcome): self
    {
        return new self(ErrorCode::AiUnavailable, $outcome);
    }

    public static function budget(): self
    {
        return new self(ErrorCode::AiBudgetExhausted);
    }

    /** SEC-P3-19: this member's own share of the feature's daily budget is used up (429 ai_daily_limit). */
    public static function memberLimit(): self
    {
        return new self(ErrorCode::AiDailyLimit);
    }

    public static function refused(): self
    {
        return new self(ErrorCode::AiRefused, AiOutcome::Refused);
    }

    public static function unverifiable(): self
    {
        return new self(ErrorCode::AiUnverifiable, AiOutcome::Invalid);
    }
}
