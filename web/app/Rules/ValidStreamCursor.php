<?php

namespace App\Rules;

use App\Services\Home\StreamCursor;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A Für dich cursor this server signed (StreamCursor). Forged, cut or from another list: the same 422 as ValidCursor.
 */
final class ValidStreamCursor implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || StreamCursor::decode($value) === null) {
            $fail((string) __('errors.cursor_invalid'));
        }
    }
}
