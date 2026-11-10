<?php

namespace App\Enums;

/**
 * ai_calls.outcome: the provider answered and the answer passed every check (ok), failed (error), took too long (timeout), declined
 * the request as outside what the feature may do (refused), or answered something a post-check rejected (invalid: a malformed answer,
 * a number that is not in the input, a value outside the catalogue).
 */
enum AiOutcome: string
{
    case Ok = 'ok';
    case Error = 'error';
    case Timeout = 'timeout';
    case Refused = 'refused';
    case Invalid = 'invalid';
}
