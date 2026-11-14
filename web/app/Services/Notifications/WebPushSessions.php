<?php

namespace App\Services\Notifications;

use App\Models\PersonalAccessToken;
use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * SEC-414-02 (ADR-452): a browser's Web Push lives only as long as the member web sign-in that turned it on. A subscription with a
 * session_key whose browser session is gone (expired after session.lifetime idle minutes, pruned, ended) goes: in the hourly prune and
 * at send time, so a shared computer stops getting the member's notifications once the session expired, signed out or not. Only the
 * database session driver can tell a live session; without it, and for a subscription without a session, one that the browser has
 * not renewed for speedclub.web_push.orphan_days goes in the prune (the member web re-registers at every sign-in).
 *
 * SEC-P4-01: a subscription registered with an app token (token_id) lives as long as that token, whatever the session driver. The
 * foreign key deletes it with the token; one whose token expired (or belongs to someone else) is ended here, in the prune and at send time.
 */
final class WebPushSessions
{
    /**
     * Deletes the subscriptions of ended sessions and the stale ones. Returns how many went.
     */
    public function prune(): int
    {
        $tracks = $this->tracksSessions();

        // SEC-P4-01: a token-tied subscription whose token ended. The foreign key took those of deleted tokens already.
        $removed = PushSubscription::query()
            ->whereNotNull('token_id')
            ->whereNotExists(fn ($tokens) => $tokens->selectRaw('1')->from('personal_access_tokens')
                ->whereColumn('personal_access_tokens.id', 'push_subscriptions.token_id')
                ->whereColumn('personal_access_tokens.tokenable_id', 'push_subscriptions.user_id')
                ->where('personal_access_tokens.tokenable_type', (new User)->getMorphClass())
                ->where(fn ($live) => $live->whereNull('personal_access_tokens.expires_at')->orWhere('personal_access_tokens.expires_at', '>', now())))
            ->delete();

        // A tracked session decides for its own subscription below; the rest has only its age.
        $removed += PushSubscription::query()
            ->where('updated_at', '<', now()->subDays(max(1, config()->integer('speedclub.web_push.orphan_days'))))
            ->when($tracks, fn ($query) => $query->whereNull('session_key'))
            ->delete();

        if (! $tracks) {
            return $removed;
        }

        PushSubscription::query()->whereNotNull('session_key')->select(['id', 'user_id', 'session_key'])
            ->chunkById(500, function (Collection $chunk) use (&$removed): void {
                /** @var Collection<int, PushSubscription> $chunk */
                $live = $this->liveKeys($this->userIds($chunk->all()));
                $ended = [];

                foreach ($chunk as $row) {
                    if (! isset($live[(string) $row->session_key])) {
                        $ended[] = $row->id;
                    }
                }

                if ($ended !== []) {
                    $removed += PushSubscription::query()->whereKey($ended)->delete();
                }
            });

        return $removed;
    }

    /**
     * The subscriptions that may still get a push; those of an ended session are deleted on the way (at most max_per_member rows).
     *
     * @param  iterable<PushSubscription>  $subscriptions
     * @return list<PushSubscription>
     */
    public function live(iterable $subscriptions): array
    {
        $rows = [];

        foreach ($subscriptions as $row) {
            $rows[] = $row;
        }

        $tracks = $this->tracksSessions();
        $live = $tracks ? $this->liveKeys($this->userIds($rows)) : [];
        $tokens = $this->liveTokens($rows);
        $keep = [];
        $ended = [];

        foreach ($rows as $row) {
            $alive = match (true) {
                // SEC-P4-01: registered with an app token, it lives with that token of the same member.
                $row->token_id !== null => ($tokens[$row->token_id] ?? null) === $row->user_id,
                $row->session_key !== null && $tracks => isset($live[$row->session_key]),
                default => true,
            };

            if ($alive) {
                $keep[] = $row;
            } else {
                $ended[] = $row->id;
            }
        }

        if ($ended !== []) {
            PushSubscription::query()->whereKey($ended)->delete();
        }

        return $keep;
    }

    /**
     * @param  list<PushSubscription>  $rows
     * @return array<int, string> token id => member id, for the unexpired member tokens the rows are tied to
     */
    private function liveTokens(array $rows): array
    {
        $ids = [];

        foreach ($rows as $row) {
            if ($row->token_id !== null) {
                $ids[$row->token_id] = true;
            }
        }

        if ($ids === []) {
            return [];
        }

        /** @var array<int, string> */
        return PersonalAccessToken::query()
            ->whereKey(array_keys($ids))
            ->where('tokenable_type', (new User)->getMorphClass())
            ->where(fn ($live) => $live->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->pluck('tokenable_id', 'id')
            ->map(fn ($owner): string => (string) $owner)
            ->all();
    }

    /**
     * @param  array<int, PushSubscription>  $rows
     * @return list<string>
     */
    private function userIds(array $rows): array
    {
        $ids = [];

        foreach ($rows as $row) {
            $ids[$row->user_id] = true;
        }

        return array_keys($ids);
    }

    /**
     * @param  list<string>  $userIds
     * @return array<string, true> session keys (PushSubscription::sessionKey) of the members' live browser sessions
     */
    private function liveKeys(array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        $since = now()->subMinutes(config()->integer('session.lifetime'))->getTimestamp();
        $keys = [];

        foreach ($this->sessions()->whereIn('user_id', $userIds)->where('last_activity', '>', $since)->pluck('id') as $id) {
            $keys[PushSubscription::sessionKey((string) $id)] = true;
        }

        return $keys;
    }

    private function tracksSessions(): bool
    {
        return config('session.driver') === 'database';
    }

    private function sessions(): Builder
    {
        $connection = config('session.connection');

        /** @var ConnectionInterface $db */
        $db = DB::connection(is_string($connection) ? $connection : null);

        return $db->table(config()->string('session.table'));
    }
}
