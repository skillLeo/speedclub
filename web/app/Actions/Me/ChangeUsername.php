<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\UsernameAvailability;
use App\Support\DisplayDate;
use App\Support\Username;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * 02_PRODUCT_SPEC §3.1. The first choice is free, a change after it waits 30 days. Format and reserved words were checked
 * by the FormRequest; the unique index has the last word on a race between two members. Two requests of one member meet
 * at the row lock, where the second one sees the first one's change and its cooldown.
 */
class ChangeUsername
{
    public function __construct(private readonly UsernameAvailability $availability) {}

    public function handle(User $user, string $username): User
    {
        $username = Username::normalize($username);

        if ($user->username === $username) {
            return $user;
        }

        $this->ensureMayChange($user, $username);

        // Slow, so it stays outside the lock. The password does not change with the username.
        if (Hash::check($username, $user->getAuthPassword())) {
            throw ValidationException::withMessages(['username' => [(string) __('username.same_as_password')]]);
        }

        try {
            return DB::transaction(function () use ($user, $username): User {
                $locked = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

                if ($locked->username === $username) {
                    return $locked;
                }

                $this->ensureMayChange($locked, $username);

                $previous = $locked->username;
                $locked->username = $username;

                if ($previous !== null) {
                    $locked->forceFill(['previous_username' => $previous, 'username_changed_at' => now()]);
                }

                $locked->save();

                Audit::record(MemberSecurityEvent::UsernameChanged->value, $locked, ['username' => $previous], ['username' => $username], actor: $locked);

                return $locked;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages(['username' => [(string) __('username.taken')]]);
        }
    }

    private function ensureMayChange(User $user, string $username): void
    {
        $until = $user->usernameChangeAvailableAt();

        if ($user->hasUsername() && $until !== null) {
            throw new ApiException(
                ErrorCode::UsernameChangeCooldown,
                (string) __('errors.username_change_cooldown_until', ['date' => DisplayDate::format($until)]),
                data: ['until' => $until->toIso8601String()],
            );
        }

        if ($this->availability->reason($username, $user) !== null) {
            throw ValidationException::withMessages(['username' => [(string) __('username.taken')]]);
        }
    }
}
