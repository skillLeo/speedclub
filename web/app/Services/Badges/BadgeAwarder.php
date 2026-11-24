<?php

namespace App\Services\Badges;

use App\Enums\BadgeMetric;
use App\Enums\OnboardingState;
use App\Enums\UserStatus;
use App\Jobs\Badges\EvaluateBadges;
use App\Models\Badge;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Awards badges by their rules (m5.9d contract §2): on events (EvaluateBadges, queued after the action committed, one per member at a
 * time), nightly for everybody (BadgesNightly, retroactive: early members get what they already reached) and when staff apply a rule
 * now (ApplyBadgeSlice). Idempotent: user_badges is unique per member and badge, a badge is never taken back. Only real members earn:
 * verified, terms accepted, active, not deleted, never a sample account.
 *
 * An award writes the member's badge_unlocked row (HOME-02); a push only for awards from an event, by the member's switch (default
 * off), the quiet hours and the shared social limit. The app's toast reads GET me/badges?unseen=1.
 */
final class BadgeAwarder
{
    public function __construct(
        private readonly BadgeRules $rules,
        private readonly BadgeMetrics $metrics,
        private readonly Notifier $notifier,
    ) {}

    /**
     * Checks the member's badges once the current transaction committed (queued, unique per member until it runs).
     */
    public function queue(User|string $user): void
    {
        $id = $user instanceof User ? $user->id : $user;

        DB::afterCommit(function () use ($id): void {
            try {
                EvaluateBadges::dispatch($id);
            } catch (Throwable $exception) {
                report($exception);
            }
        });
    }

    /**
     * Every active badge the member reached and does not have yet; returns the new keys.
     *
     * @return list<string>
     */
    public function evaluate(User $user, string $source = 'event', bool $push = true): array
    {
        return $this->evaluateMany([$user->id], $this->activeBadges(), $source, $push)[$user->id] ?? [];
    }

    /**
     * @param  list<string>  $userIds
     * @param  Collection<int, Badge>  $badges
     * @return array<string, list<string>> member id => new badge keys
     */
    public function evaluateMany(array $userIds, Collection $badges, string $source, bool $push): array
    {
        $members = $this->eligible($userIds);

        if ($members->isEmpty() || $badges->isEmpty()) {
            return [];
        }

        $ids = array_values(array_map(strval(...), $members->modelKeys()));
        $earned = [];

        foreach (DB::table('user_badges')->whereIn('user_id', $ids)->whereIn('badge_key', $badges->modelKeys())->get(['user_id', 'badge_key']) as $row) {
            $earned[$row->user_id.'|'.$row->badge_key] = true;
        }

        $values = [];
        $awarded = [];

        foreach ($badges as $badge) {
            $rule = $this->rules->read($badge->rule_json);

            if ($rule === null) {
                continue;
            }

            $cacheKey = $rule['metric'].'|'.($rule['set'] ?? '');
            $values[$cacheKey] ??= $this->metrics->values(BadgeMetric::from($rule['metric']), $rule['set'] ?? null, $ids);

            foreach ($members as $member) {
                if (isset($earned[$member->id.'|'.$badge->key]) || ! $this->rules->matches($rule, $values[$cacheKey][$member->id] ?? 0)) {
                    continue;
                }

                if ($this->award($member, $badge, $source, $push)) {
                    $awarded[$member->id][] = $badge->key;
                }
            }
        }

        return $awarded;
    }

    /**
     * Gives $badge to $user once; false when the member had it already.
     */
    public function award(User $user, Badge $badge, string $source, bool $push): bool
    {
        $inserted = DB::table('user_badges')->insertOrIgnore([
            'user_id' => $user->id,
            'badge_key' => $badge->key,
            'awarded_at' => now(),
            'source_ref' => mb_substr($source, 0, 100),
            'seen_at' => null,
        ]) === 1;

        if ($inserted) {
            $this->notifier->badgeUnlocked($user, $badge, $push);
        }

        return $inserted;
    }

    /**
     * "Würde heute N Mitglieder erhalten" (admin badge manager): real members whose metric meets the rule now, earned or not.
     *
     * @param  array<string, mixed>  $rule
     */
    public function preview(array $rule): int
    {
        $rule = $this->rules->validate($rule);
        $values = $this->metrics->query(BadgeMetric::from($rule['metric']), $rule['set'] ?? null, null);

        return $this->eligibleQuery(DB::query()->fromSub($values, 'mv')->join('users as u', 'u.id', '=', 'mv.user_id'))
            ->where('mv.value', '>=', $this->rules->threshold($rule))
            ->count();
    }

    /**
     * @return Collection<int, Badge>
     */
    public function activeBadges(): Collection
    {
        return Badge::query()->where('active', true)->orderBy('sort')->orderBy('key')->get();
    }

    /**
     * @param  list<string>  $userIds
     * @return Collection<int, User>
     */
    private function eligible(array $userIds): Collection
    {
        return User::query()->whereKey($userIds)
            ->where('is_sample', false)
            ->where('status', UserStatus::Active->value)
            ->whereNotNull('email_verified_at')
            ->where(fn ($query) => $query->whereNull('onboarding_state')->orWhere('onboarding_state', '!=', OnboardingState::PendingTerms->value))
            ->get();
    }

    /**
     * The rules of eligible() on a query holding users as u.
     */
    private function eligibleQuery(Builder $query): Builder
    {
        return $query->whereNull('u.deleted_at')
            ->where('u.is_sample', false)
            ->where('u.status', UserStatus::Active->value)
            ->whereNotNull('u.email_verified_at')
            ->where(fn (Builder $terms) => $terms->whereNull('u.onboarding_state')->orWhere('u.onboarding_state', '!=', OnboardingState::PendingTerms->value));
    }
}
