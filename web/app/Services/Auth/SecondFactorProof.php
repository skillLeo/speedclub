<?php

namespace App\Services\Auth;

use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * SEC-M46-02: whether the sign-in behind this request passed the second factor (AUTH-11). A token keeps it in second_factor_at, across
 * rotations; a browser in its session. Provider and passkey sign-ins skip the second factor (ADR-429 g), so their sessions have none.
 */
final class SecondFactorProof
{
    public const SESSION_KEY = 'auth.second_factor_at';

    public static function passed(User $user, Request $request): bool
    {
        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken && $token->exists) {
            return $token->getAttribute('second_factor_at') !== null;
        }

        return $request->hasSession() && $request->session()->has(self::SESSION_KEY);
    }
}
