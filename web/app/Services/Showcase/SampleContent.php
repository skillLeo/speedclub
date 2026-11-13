<?php

namespace App\Services\Showcase;

use App\Models\Business;
use App\Models\Event;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Contracts\Database\Query\Builder;

/**
 * Sample content (09 §8.19, ADR-412): the showcase and the SPEED CLUB Editorial account (users.is_sample, vehicles.is_sample) are seen
 * only while the flag editorial_samples is on (local and staging by default, off in production). With the flag off, no member-facing or
 * public read shows them: lists drop them in their query (constrain), single pages answer like a missing item (hides, from the
 * policies), and their numbers stay out of real members' counts. The owner of a sample account still sees their own things.
 *
 * Every read goes through this class, so the rule lives in one place: VisibleBuilds (Home, Entdecken, search, collections, popular mods,
 * build updates), saved builds (SaveController), notifications (NotificationFeed actors and vehicles), messaging (inbox and
 * MessagingEligibility), the member queries (search, followers/following, counts), VehiclePolicy/UserPolicy (/v, /u and their
 * API, QR, share cards, OG images by way of the page), the sitemap and the landing page. M4.12: events (EventPolicy, EventFeed lists,
 * the calendar file) with their organiser, the sample events of ShowcaseEvents included. M4.14: businesses (BusinessPolicy, the business
 * lists) with their owner, the sample businesses of ShowcaseBusinesses included.
 */
final class SampleContent
{
    public const FLAG = 'editorial_samples';

    public function __construct(private readonly FeatureFlags $flags) {}

    public function visible(): bool
    {
        return $this->flags->enabled(self::FLAG);
    }

    /**
     * Drops rows whose is_sample columns ($columns, qualified: "v.is_sample", "u.is_sample") are set, while samples are hidden.
     *
     * @template TQuery of Builder
     *
     * @param  TQuery  $query
     * @return TQuery
     */
    public function constrain(Builder $query, string ...$columns): Builder
    {
        if (! $this->visible()) {
            foreach ($columns as $column) {
                $query->where($column, false);
            }
        }

        return $query;
    }

    /**
     * Whether $viewer must not see $item: samples are hidden and the item (a vehicle, or its owner) is a sample, unless it is the
     * viewer's own.
     */
    public function hides(Vehicle|User|Event|Business $item, ?User $viewer = null): bool
    {
        if (! self::isSample($item) || $this->visible()) {
            return false;
        }

        $owner = match (true) {
            $item instanceof Vehicle => $item->getAttribute('owner_id'),
            $item instanceof Event => $item->organiser_id,
            $item instanceof Business => $item->owner_id,
            default => $item->getKey(),
        };

        return $viewer === null || (string) $viewer->getKey() !== (string) $owner;
    }

    /**
     * A count shown for $item, or null for a sample: 09 §8.19 hides every count on samples (followers, following, builds), so no
     * seeded number reads like a real one.
     */
    public static function count(Vehicle|User|Event|Business $item, int $count): ?int
    {
        return self::isSample($item) ? null : $count;
    }

    /**
     * MemberStats for $member, each null for a sample member.
     *
     * @param  array{vehicles: int, followers: int, following: int}  $stats
     * @return array{vehicles: int|null, followers: int|null, following: int|null}
     */
    public static function stats(User $member, array $stats): array
    {
        return array_map(fn (int $count): ?int => self::count($member, $count), $stats);
    }

    /**
     * A sample vehicle (its own flag or its owner's), a sample event (its own flag or its organiser's) or a sample member.
     */
    public static function isSample(Vehicle|User|Event|Business $item): bool
    {
        if ($item->getAttribute('is_sample') === true) {
            return true;
        }

        return match (true) {
            $item instanceof Vehicle => $item->owner?->getAttribute('is_sample') === true,
            $item instanceof Event => $item->organiser->getAttribute('is_sample') === true,
            $item instanceof Business => $item->owner->getAttribute('is_sample') === true,
            default => false,
        };
    }
}
