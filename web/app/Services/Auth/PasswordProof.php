<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Checks a password with the same work whether or not there is an account, so the time of an answer reveals nothing.
 */
final class PasswordProof
{
    public function check(?User $user, string $password): bool
    {
        return Hash::check($password, $user === null ? $this->dummyHash() : $user->getAuthPassword()) && $user !== null;
    }

    /**
     * A hash with the current settings. Kept in the cache: making it per request would double the work of this path.
     */
    private function dummyHash(): string
    {
        $settings = hash('sha256', (string) json_encode(config('hashing')));

        return Cache::rememberForever('auth-dummy-hash:'.$settings, fn (): string => Hash::make(Str::random(40)));
    }
}
