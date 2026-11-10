<?php

namespace App\Services\Support;

use App\Enums\AdminMemberEvent;
use App\Enums\AuditActorType;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * SEC-P3-21: address reveals (the member PII reveal, the web contact of a ticket and, SEC-P3-25, a web notifier on ADM-21) are capped per
 * staff member and day (Europe/Berlin),
 * speedclub.staff.pii_reveals_per_day, so a script cannot stand in for the four-eyes list export. The count is the audit log's own
 * (`member.pii_viewed`, `support.contact_viewed`, `moderation.contact_viewed`). The reveal that reaches the cap is refused (429) and audited once as
 * `staff.pii_reveal_limit_reached`, which raises a staff alert for everyone holding audit.view (AlertsData::systemWarnings).
 */
final class PiiReveals
{
    public const EVENTS = [AdminMemberEvent::PiiViewed->value, 'support.contact_viewed', 'moderation.contact_viewed'];

    public const LIMIT_EVENT = 'staff.pii_reveal_limit_reached';

    /**
     * @throws HttpException 429 when today's reveals are used up
     */
    public static function ensureAllowed(Staff $staff): void
    {
        $since = self::midnight();
        $limit = max(1, config()->integer('speedclub.staff.pii_reveals_per_day', 200));
        $count = self::actorEvents($staff, $since)->whereIn('action', self::EVENTS)->count();

        if ($count < $limit) {
            return;
        }

        if (! self::actorEvents($staff, $since)->where('action', self::LIMIT_EVENT)->exists()) {
            DB::transaction(fn () => Audit::record(self::LIMIT_EVENT, $staff, after: ['reveals' => $count, 'limit' => $limit], actor: $staff));
        }

        throw new HttpException(429, (string) __('team.refused.pii_reveal_limit', ['limit' => $limit]));
    }

    /** Whether any staff member reached the cap today (the alert). */
    public static function limitReachedToday(): bool
    {
        return AuditEvent::query()->where('action', self::LIMIT_EVENT)->where('occurred_at', '>=', self::midnight())->exists();
    }

    /**
     * @return Builder<AuditEvent>
     */
    private static function actorEvents(Staff $staff, Carbon $since)
    {
        return AuditEvent::query()
            ->where('actor_type', AuditActorType::Staff->value)
            ->where('actor_id', (string) $staff->getKey())
            ->where('occurred_at', '>=', $since);
    }

    private static function midnight(): Carbon
    {
        return Carbon::now(config()->string('speedclub.display_timezone'))->startOfDay()->utc();
    }
}
