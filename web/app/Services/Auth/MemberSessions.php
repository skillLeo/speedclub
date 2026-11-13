<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Facades\DB;

final class MemberSessions
{
    /**
     * Ends every sign-in of the account, this device and browser included.
     *
     * The audit log gets this array as it is and redacts any key with "token" in it, so the count is under devices.
     *
     * $keepExportLinks: only for the member's own deletion, which keeps an export downloadable for its 7 days (ADR-203 c, the deletion
     * screens promise it); every other caller ends such links with the sign-ins (SEC-P2-02).
     *
     * @return array{devices: int, sessions: int}
     */
    public function revokeAll(User $user, bool $keepExportLinks = false): array
    {
        // A signed-out device must not keep getting pushes (M2.2).
        $user->pushTokens()->delete();
        // M4.15: nor a browser its Web Push (the member web drops its own subscription at a normal sign-out).
        $user->pushSubscriptions()->delete();
        // Nor keep a signed link that is a credential of its own, such as the export download (SEC-P2-02).
        if (! $keepExportLinks) {
            CredentialEpoch::rotate($user);
        }

        return [
            'devices' => $user->tokens()->delete(),
            'sessions' => $this->deleteSessions($user),
        ];
    }

    /**
     * With other session drivers the password hash Sanctum keeps in the session ends them at the next password change.
     */
    private function deleteSessions(User $user): int
    {
        if (config('session.driver') !== 'database') {
            return 0;
        }

        $connection = config('session.connection');

        return DB::connection(is_string($connection) ? $connection : null)
            ->table(config()->string('session.table'))
            ->where('user_id', $user->getKey())
            ->delete();
    }
}
