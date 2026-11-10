<?php

namespace App\Actions\Moderation;

use App\Enums\UserStatus;
use App\Models\User;
use App\Services\Audit\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Ends what DecideCase put on an account once its `until` has passed (M2.6 review #1). A timed suspension otherwise only stopped
 * counting in User::isSuspended(), while every list that filters on `status = active` kept hiding the member. For each such account,
 * under its row lock: the expired keys of users.restrictions go, a suspended status whose suspension expired becomes active, and one
 * audit event (`moderation.restriction_lifted`, actor system) records which keys went. No end date (null) never expires; an unreadable
 * date keeps the restriction (fail closed, as User::endOf()). Idempotent; bounded per run.
 */
class LiftExpiredRestrictions
{
    private const KEYS = ['suspension', 'messaging', 'publishing'];

    private const CHUNK = 200;

    public function handle(?CarbonImmutable $now = null): int
    {
        $now ??= CarbonImmutable::now();
        $lifted = 0;

        User::query()
            ->whereNotNull('restrictions')
            ->select('id')
            ->chunkById(self::CHUNK, function ($users) use ($now, &$lifted): void {
                foreach ($users as $user) {
                    $lifted += $this->lift((string) $user->id, $now) ? 1 : 0;
                }
            });

        return $lifted;
    }

    private function lift(string $id, CarbonImmutable $now): bool
    {
        return DB::transaction(function () use ($id, $now): bool {
            $user = User::query()->whereKey($id)->lockForUpdate()->first();
            $restrictions = $user instanceof User && is_array($user->restrictions) ? $user->restrictions : [];
            $expired = array_values(array_filter(self::KEYS, fn (string $key): bool => isset($restrictions[$key]) && $this->hasEnded($restrictions[$key]['until'] ?? null, $now)));

            if (! $user instanceof User || $expired === []) {
                return false;
            }

            $before = ['status' => $user->status->value, 'restrictions' => $restrictions];
            $remaining = array_diff_key($restrictions, array_flip($expired));
            $changes = ['restrictions' => $remaining === [] ? null : $remaining];

            if ($user->status === UserStatus::Suspended && in_array('suspension', $expired, true)) {
                $changes['status'] = UserStatus::Active;
            }

            $user->forceFill($changes)->save();

            Audit::record('moderation.restriction_lifted', $user, $before, ['status' => $user->status->value, 'lifted' => $expired], 'until passed');

            return true;
        });
    }

    private function hasEnded(mixed $until, CarbonImmutable $now): bool
    {
        if (! is_string($until) || preg_match('/\A\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/', $until) !== 1) {
            return false;
        }

        try {
            return CarbonImmutable::parse($until)->lessThanOrEqualTo($now);
        } catch (\Throwable) {
            return false;
        }
    }
}
