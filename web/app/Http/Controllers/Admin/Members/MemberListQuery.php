<?php

namespace App\Http\Controllers\Admin\Members;

use App\Enums\CaseStatus;
use App\Enums\UserStatus;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\MemberRecord;
use App\Support\EmailAddress;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as QueryBuilderBase;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-09's query, shared by the page and its CSV (m3.2-contract §2): whitelisted filters and sorts, a deterministic order (the id breaks
 * every tie, so a page and a baseline never reshuffle), and the row a page shows. The e-mail address is masked for everybody
 * (SEC-P3-02); the text filter matches an exact address only for members.view_pii, so a masked list cannot be probed address by address.
 */
final class MemberListQuery
{
    public const TABLE = 'members';

    public const DEFAULT_SORT = '-created_at';

    public const FILTERS = ['q', 'status', 'verified', 'restricted', 'reported', 'has_vehicles', 'registered_from', 'registered_to', 'active_from', 'active_to'];

    private const RESTRICTIONS = ['messaging', 'publishing'];

    /**
     * @return QueryBuilder<User>
     */
    public static function build(Request $request, Staff $staff): QueryBuilder
    {
        $base = User::query()
            ->with('avatar')
            ->withCount(['vehicles', 'followers']);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', fn (Builder $q, mixed $value) => self::text($q, $value, $staff))->delimiter("\u{1}"),
                AllowedFilter::callback('status', function (Builder $q, mixed $value): void {
                    $status = UserStatus::tryFrom(is_string($value) ? $value : '');
                    $q->where('users.status', $status->value ?? '-');
                })->delimiter("\u{1}"),
                AllowedFilter::callback('verified', fn (Builder $q, mixed $value) => self::truthy($value) ? $q->whereNotNull('users.email_verified_at') : $q->whereNull('users.email_verified_at'))->delimiter("\u{1}"),
                AllowedFilter::callback('restricted', fn (Builder $q, mixed $value) => self::restricted($q, is_string($value) ? $value : ''))->delimiter("\u{1}"),
                AllowedFilter::callback('reported', function (Builder $q, mixed $value): void {
                    $open = fn (QueryBuilderBase $sub) => $sub->selectRaw('1')->from('moderation_cases')
                        ->whereColumn('moderation_cases.subject_id', 'users.id')
                        ->whereIn('moderation_cases.status', [CaseStatus::New->value, CaseStatus::InReview->value]);
                    self::truthy($value) ? $q->whereExists($open) : $q->whereNotExists($open);
                })->delimiter("\u{1}"),
                AllowedFilter::callback('has_vehicles', fn (Builder $q, mixed $value) => self::truthy($value) ? $q->has('vehicles') : $q->doesntHave('vehicles'))->delimiter("\u{1}"),
                AllowedFilter::callback('registered_from', fn (Builder $q, mixed $value) => $q->where('users.created_at', '>=', self::day($value)->startOfDay()->utc()))->delimiter("\u{1}"),
                AllowedFilter::callback('registered_to', fn (Builder $q, mixed $value) => $q->where('users.created_at', '<=', self::day($value)->endOfDay()->utc()))->delimiter("\u{1}"),
                AllowedFilter::callback('active_from', fn (Builder $q, mixed $value) => $q->where('users.last_seen_at', '>=', self::day($value)->startOfDay()->utc()))->delimiter("\u{1}"),
                AllowedFilter::callback('active_to', fn (Builder $q, mixed $value) => $q->where('users.last_seen_at', '<=', self::day($value)->endOfDay()->utc()))->delimiter("\u{1}"),
            )
            ->allowedSorts('username', 'created_at', 'last_seen_at', 'vehicles_count', 'followers_count')
            ->defaultSort(self::DEFAULT_SORT);

        // Tie-breaker after the requested sort.
        $query->getEloquentBuilder()->orderBy('users.id');

        return $query;
    }

    /**
     * @param  list<User>  $members
     * @return list<array<string, mixed>>
     */
    public static function rows(array $members, Staff $staff): array
    {
        $now = CarbonImmutable::now();

        return array_map(fn (User $member): array => [
            'id' => $member->id,
            'username' => $member->username,
            'display_name' => $member->getAttribute('display_name'),
            'avatar' => MediaUrls::at($member->avatar, 64),
            // Masked for everybody (SEC-P3-02): the full address only through the audited reveal on ADM-10.
            'email' => MemberRecord::maskEmail($member->email),
            'status' => self::status($member),
            'restricted' => self::restrictionsInForce($member, $now),
            'vehicles' => (int) $member->getAttribute('vehicles_count'),
            'followers' => (int) $member->getAttribute('followers_count'),
            'created_at' => $member->created_at?->toIso8601String(),
            'last_seen_at' => self::iso($member->getAttribute('last_seen_at')),
            'two_factor' => $member->hasTwoFactor(),
            'verified' => $member->getAttribute('email_verified_at') !== null,
        ], $members);
    }

    /**
     * active · restricted · suspended · deactivated · pending_deletion: the one word the status pill shows.
     */
    public static function status(User $member): string
    {
        return match (true) {
            $member->isPendingDeletion() => 'pending_deletion',
            $member->isDeactivated() => 'deactivated',
            $member->isSuspended() => 'suspended',
            self::restrictionsInForce($member, CarbonImmutable::now()) !== [] => 'restricted',
            default => 'active',
        };
    }

    /**
     * @return list<string>
     */
    public static function restrictionsInForce(User $member, CarbonImmutable $now): array
    {
        $restrictions = is_array($member->restrictions) ? $member->restrictions : [];
        $inForce = [];

        foreach (self::RESTRICTIONS as $type) {
            if (! array_key_exists($type, $restrictions)) {
                continue;
            }
            $until = $restrictions[$type]['until'] ?? null;
            if (! is_string($until) || strtotime($until) === false || CarbonImmutable::parse($until)->isAfter($now)) {
                $inForce[] = $type;
            }
        }

        return $inForce;
    }

    /**
     * "lukas" / "@lukas" → username prefix; an address → that exact address, only for members.view_pii.
     *
     * @param  Builder<Model>  $query
     */
    private static function text(Builder $query, mixed $value, Staff $staff): void
    {
        $text = trim(is_string($value) ? $value : '');

        if (str_contains($text, '@') && ! str_starts_with($text, '@')) {
            $staff->can('members.view_pii')
                ? $query->where('users.email', EmailAddress::normalize($text))
                : $query->whereRaw('1 = 0');

            return;
        }

        $prefix = mb_strtolower(ltrim($text, '@'));
        $query->where('users.username', 'like', addcslashes($prefix, '%_\\').'%');
    }

    /**
     * any · messaging · publishing · suspended. A restriction counts while its end has not passed (User::isInForce).
     *
     * @param  Builder<Model>  $query
     */
    private static function restricted(Builder $query, string $value): void
    {
        $now = CarbonImmutable::now()->utc()->toIso8601String();
        $inForce = fn (Builder $q, string $type) => $q->whereRaw("JSON_CONTAINS_PATH(users.restrictions, 'one', ?)", ['$.'.$type])
            ->where(fn (Builder $w) => $w
                ->whereRaw("JSON_TYPE(JSON_EXTRACT(users.restrictions, ?)) IS NULL OR JSON_TYPE(JSON_EXTRACT(users.restrictions, ?)) = 'NULL'", ['$.'.$type.'.until', '$.'.$type.'.until'])
                ->orWhereRaw('JSON_UNQUOTE(JSON_EXTRACT(users.restrictions, ?)) > ?', ['$.'.$type.'.until', $now]));

        match ($value) {
            'messaging', 'publishing' => $inForce($query, $value),
            'suspended' => $query->where('users.status', UserStatus::Suspended->value),
            'any' => $query->where(fn (Builder $any) => $any
                ->where('users.status', UserStatus::Suspended->value)
                ->orWhere(fn (Builder $q) => $inForce($q, 'messaging'))
                ->orWhere(fn (Builder $q) => $inForce($q, 'publishing'))),
            default => $query->whereRaw('1 = 0'),
        };
    }

    private static function truthy(mixed $value): bool
    {
        return in_array($value, ['1', 1, true, 'true', 'yes'], true);
    }

    private static function day(mixed $value): CarbonImmutable
    {
        $value = is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : 'today';

        return CarbonImmutable::parse($value, 'Europe/Berlin');
    }

    private static function iso(mixed $value): ?string
    {
        return $value instanceof \DateTimeInterface ? CarbonImmutable::instance($value)->toIso8601String() : null;
    }
}
