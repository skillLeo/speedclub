<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\DeviceSessions;
use App\Services\Auth\Reauthentication;
use App\Services\Notifications\Notifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * SET-06: end one device or browser, or every one but this. This device signs out through auth/logout, not here.
 */
class RevokeDeviceSessions
{
    public function __construct(
        private readonly DeviceSessions $sessions,
        private readonly Notifier $notifier,
        private readonly Reauthentication $reauthentication,
    ) {}

    public function one(User $user, string $id, Request $request): void
    {
        if ($this->sessions->isCurrent($user, $id, $request)) {
            throw ValidationException::withMessages(['id' => [(string) __('settings.sessions.current')]]);
        }

        $found = DB::transaction(function () use ($user, $id): bool {
            if (! $this->sessions->revoke($user, $id)) {
                return false;
            }

            Audit::record(MemberSecurityEvent::SessionRevoked->value, $user, after: ['devices' => str_starts_with($id, 't') ? 1 : 0, 'sessions' => str_starts_with($id, 'w') ? 1 : 0], actor: $user);

            return true;
        });

        if (! $found) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $this->notify($user);
    }

    /**
     * M4.7 (09 §8.4): recent authentication, or the password of a member who has one (Reauthentication::password).
     */
    public function others(User $user, Request $request, string $password = ''): void
    {
        $this->reauthentication->password($user, $password);

        $revoked = DB::transaction(function () use ($user, $request): array {
            $revoked = $this->sessions->revokeOthers($user, $request);

            Audit::record(MemberSecurityEvent::SessionRevoked->value, $user, after: $revoked, actor: $user);

            return $revoked;
        });

        if ($revoked['devices'] + $revoked['sessions'] > 0) {
            $this->notify($user);
        }
    }

    private function notify(User $user): void
    {
        $token = $user->currentAccessToken();

        $this->notifier->security($user, SecurityNotice::SessionsRevoked, $token instanceof PersonalAccessToken ? $token->deviceName() : null);
    }
}
