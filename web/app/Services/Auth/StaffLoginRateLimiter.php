<?php

namespace App\Services\Auth;

use Illuminate\Http\Request;
use Laravel\Fortify\LoginRateLimiter;

/**
 * Fortify's key holds the address as sent, LoginRequest sets no maximum, and the cache table's key column ends at 255 characters:
 * a long address answered 500 after the password check, and a new one each time never reached the limit (SEC-P1-42).
 */
final class StaffLoginRateLimiter extends LoginRateLimiter
{
    protected function throttleKey(Request $request): string
    {
        return 'staff-login:'.hash('sha256', parent::throttleKey($request));
    }
}
