<?php

namespace App\Services\Progress;

use App\Enums\XpType;
use App\Models\User;
use App\Models\XpEvent;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * The XP ledger (m5.9d contract §1). One event per member, type and source (unique key), so a repeated hook changes nothing. The daily
 * cap (`xp.daily_cap`, Europe/Berlin day) and the per-type day maxima are applied under the member's row lock: an award the cap reduces
 * is stored with what was left (possibly 0) and `capped`, so the cap stays auditable and a re-run stays idempotent. users.xp is kept
 * in the same transaction. Queries go through the connection (as DexNumbers), so a caller's transaction and a test that wraps the DB
 * facade see one connection.
 *
 * Only real members earn: verified, terms accepted, active, not deleted, never a sample account (10 §16: samples never earn). The
 * callers (XpHooks) also refuse sources that are samples. Nothing here is for likes, reactions, posting volume or signing in.
 */
final class Xp
{
    public static function eligible(User $user): bool
    {
        return ! $user->trashed()
            && $user->getAttribute('is_sample') !== true
            && $user->isActive()
            && $user->hasVerifiedEmail()
            && ! $user->isPendingTerms();
    }

    /**
     * Awards $type for the source $refType/$refId once. Returns the new event (its points may be 0 when capped), or null when the member
     * cannot earn, the type earns nothing or this source already earned.
     */
    public function award(User $user, XpType $type, string $refType, string $refId, ?CarbonInterface $at = null): ?XpEvent
    {
        $base = $type->points();

        if ($base < 1 || ! self::eligible($user)) {
            return null;
        }

        $day = $this->day($at);
        $db = DB::connection();

        return $db->transaction(function () use ($db, $user, $type, $refType, $refId, $base, $day): ?XpEvent {
            $db->table('users')->where('id', $user->id)->lockForUpdate()->value('id');

            if (XpEvent::query()->where('user_id', $user->id)->where('type', $type->value)->where('ref_type', $refType)->where('ref_id', $refId)->exists()) {
                return null;
            }

            $today = XpEvent::query()->where('user_id', $user->id)->where('day', $day);
            $left = max(0, config()->integer('speedclub.xp.daily_cap') - (int) (clone $today)->sum('points'));
            $max = $type->dailyMax();

            if ($max !== null) {
                $left = min($left, max(0, $max - (int) (clone $today)->where('type', $type->value)->sum('points')));
            }

            $points = min($base, $left);
            $event = new XpEvent;
            $event->forceFill([
                'user_id' => $user->id,
                'type' => $type,
                'points' => $points,
                'capped' => $points < $base,
                'ref_type' => $refType,
                'ref_id' => $refId,
                'day' => $day,
                'created_at' => now(),
            ])->save();

            if ($points > 0) {
                $db->table('users')->where('id', $user->id)->increment('xp', $points);
                $user->forceFill(['xp' => (int) $user->getAttribute('xp') + $points])->syncOriginalAttribute('xp');
            }

            return $event;
        });
    }

    /**
     * Takes back the event of one source (staff removed the spot or post it was for: abuse, contract §1). Nothing else is ever taken
     * back. Returns how many events were removed.
     */
    public function revoke(XpType $type, string $refType, string $refId): int
    {
        $db = DB::connection();

        return $db->transaction(function () use ($db, $type, $refType, $refId): int {
            $events = XpEvent::query()->where('type', $type->value)->where('ref_type', $refType)->where('ref_id', $refId)->lockForUpdate()->get();

            foreach ($events as $event) {
                if ($event->points > 0) {
                    $xp = (int) $db->table('users')->where('id', $event->user_id)->lockForUpdate()->value('xp');
                    $db->table('users')->where('id', $event->user_id)->update(['xp' => max(0, $xp - $event->points)]);
                }

                $event->delete();
            }

            return $events->count();
        });
    }

    /**
     * XP earned on the member's Europe/Berlin day.
     */
    public function today(User $user, ?CarbonInterface $at = null): int
    {
        return (int) XpEvent::query()->where('user_id', $user->id)->where('day', $this->day($at))->sum('points');
    }

    public function day(?CarbonInterface $at = null): string
    {
        return CarbonImmutable::instance($at ?? CarbonImmutable::now())->setTimezone(config()->string('speedclub.notifications.timezone'))->toDateString();
    }
}
