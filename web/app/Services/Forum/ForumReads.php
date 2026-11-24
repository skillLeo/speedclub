<?php

namespace App\Services\Forum;

use App\Models\Block;
use App\Models\ForumPost;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Social\Mentions;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Per-request lookups of the forum resources, loaded once per page instead of once per row: the reader's blocks, their "Hilfreich" votes
 * and the visible mentions of the page's posts, and which attached vehicles the reader may see. Kept in the request's attributes.
 */
final class ForumReads
{
    private const KEY = 'speedclub.forum.reads';

    /**
     * @param  iterable<ForumPost>  $posts
     */
    public static function primePosts(Request $request, iterable $posts): void
    {
        $ids = [];

        foreach ($posts as $post) {
            $ids[] = $post->id;

            if ($post->relationLoaded('visibleReplies')) {
                foreach ($post->getRelation('visibleReplies') as $reply) {
                    $ids[] = $reply->id;
                }
            }
        }

        if ($ids === []) {
            return;
        }

        $viewer = Viewer::from($request);
        $state = self::state($request);
        $state['voted'] = [...$state['voted'], ...($viewer === null ? [] : array_fill_keys(
            DB::table('forum_votes')->where('user_id', $viewer->id)->whereIn('post_id', $ids)->pluck('post_id')->map(strval(...))->all(),
            true,
        ))];
        $state['mentions'] = [...$state['mentions'], ...app(Mentions::class)->forItems((new ForumPost)->getMorphClass(), $ids, $viewer)];
        $state['primed'] = [...$state['primed'], ...array_fill_keys($ids, true)];
        $request->attributes->set(self::KEY, $state);
    }

    public static function voted(Request $request, ForumPost $post): bool
    {
        $viewer = Viewer::from($request);

        if ($viewer === null) {
            return false;
        }

        $state = self::state($request);

        return isset($state['primed'][$post->id])
            ? isset($state['voted'][$post->id])
            : DB::table('forum_votes')->where('user_id', $viewer->id)->where('post_id', $post->id)->exists();
    }

    /**
     * @return list<User>
     */
    public static function mentions(Request $request, ForumPost $post): array
    {
        $state = self::state($request);

        if (isset($state['primed'][$post->id])) {
            return $state['mentions'][$post->id] ?? [];
        }

        return app(Mentions::class)->forItems($post->getMorphClass(), [$post->id], Viewer::from($request))[$post->id] ?? [];
    }

    /**
     * A member the reader may see in a forum line: publicly visible (or the reader), no block either way.
     */
    public static function showsMember(Request $request, ?User $member): bool
    {
        if (! $member instanceof User) {
            return false;
        }

        $viewer = Viewer::from($request);

        if ($viewer !== null && $member->is($viewer)) {
            return true;
        }

        if ($member->trashed() || ! $member->isPubliclyVisible()) {
            return false;
        }

        return ! isset(self::blocked($request)[$member->id]);
    }

    public static function showsVehicle(Request $request, ?Vehicle $vehicle): bool
    {
        if (! $vehicle instanceof Vehicle) {
            return false;
        }

        $state = self::state($request);

        if (! array_key_exists($vehicle->id, $state['vehicles'])) {
            $state['vehicles'][$vehicle->id] = Gate::forUser(Viewer::from($request))->allows('view', $vehicle);
            $request->attributes->set(self::KEY, $state);
        }

        return $state['vehicles'][$vehicle->id];
    }

    /**
     * @return array<string, true> ids of members the reader blocked or who blocked the reader
     */
    private static function blocked(Request $request): array
    {
        $state = self::state($request);

        if ($state['blocked'] === null) {
            $viewer = Viewer::from($request);
            $state['blocked'] = $viewer === null ? [] : array_fill_keys([
                ...Block::query()->where('blocker_id', $viewer->id)->pluck('blocked_id')->map(strval(...))->all(),
                ...Block::query()->where('blocked_id', $viewer->id)->pluck('blocker_id')->map(strval(...))->all(),
            ], true);
            $request->attributes->set(self::KEY, $state);
        }

        return $state['blocked'];
    }

    /**
     * @return array{voted: array<string, true>, mentions: array<string, list<User>>, primed: array<string, true>, vehicles: array<string, bool>, blocked: array<string, true>|null}
     */
    private static function state(Request $request): array
    {
        $state = $request->attributes->get(self::KEY);

        /** @var array{voted: array<string, true>, mentions: array<string, list<User>>, primed: array<string, true>, vehicles: array<string, bool>, blocked: array<string, true>|null} */
        return is_array($state) ? $state : ['voted' => [], 'mentions' => [], 'primed' => [], 'vehicles' => [], 'blocked' => null];
    }
}
