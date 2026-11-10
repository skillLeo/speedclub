<?php

namespace App\Exceptions;

use App\Enums\ErrorCode;
use App\Support\DisplayDate;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Debug\ShouldntReport;
use RuntimeException;

/**
 * Domain error for API endpoints: renders as {message, code, errors}.
 * Actions throw it for conditions a FormRequest or Policy cannot express.
 *
 * Never logged: these are expected client errors, and logging each with a stack trace would let anyone fill the
 * disk with anonymous requests. Real faults throw something else and reach the log as usual.
 */
class ApiException extends RuntimeException implements ShouldntReport
{
    /**
     * @param  array<string, list<string>>  $errors
     * @param  array<string, string>  $headers
     * @param  array<string, mixed>  $data  extra top-level fields of the error body, e.g. the until-date
     */
    public function __construct(
        public readonly ErrorCode $errorCode,
        ?string $message = null,
        public readonly array $errors = [],
        public readonly array $headers = [],
        public readonly array $data = [],
    ) {
        parent::__construct($message ?? $errorCode->message());
    }

    /**
     * 403 account_restricted with the until-date (05_ARCHITECTURE §8).
     */
    public static function accountRestricted(?CarbonImmutable $until): self
    {
        return new self(
            ErrorCode::AccountRestricted,
            $until === null
                ? null
                : (string) __('errors.account_restricted_until', ['date' => DisplayDate::format($until)]),
            data: ['until' => $until?->toIso8601String()],
        );
    }
}
