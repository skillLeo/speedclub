<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\React;
use App\Actions\Social\Unreact;
use App\Enums\ErrorCode;
use App\Enums\ReactableType;
use App\Enums\ReactionType;
use App\Enums\UserStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\ReactRequest;
use App\Http\Requests\Api\V1\Social2\SocialListRequest;
use App\Http\Resources\V1\ReactionRowResource;
use App\Http\Resources\V1\ReactionStateResource;
use App\Models\BuildUpdate;
use App\Models\Reaction;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Social\Reactions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Private reactions (09 §8.5, ADR-413, flag build_reactions): Stark · Sauber · Tief · Laut on a build (`vehicles`) or a build update
 * (`build-updates`). Everybody reads only their own reaction; the owner alone reads who reacted and how many. No response to anybody else
 * ever carries a count.
 */
class ReactionController extends Controller
{
    /**
     * Set or change my reaction.
     *
     * One per member and item: a second PUT replaces the first. Answers with my reaction only. Own item: 403. Unverified: 403
     * email_not_verified. Anything the viewer may not see, also across a block: 404.
     */
    public function update(ReactRequest $request, string $id, React $action): ReactionStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $reactable = self::type($request);
        $target = $this->target($reactable, $id);

        if ($target === null || ! Gate::allows('view', $target)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('create', [Reaction::class, $target]);

        $reaction = ReactionType::from($request->string('reaction')->toString());
        $action->handle($user, $target, $reaction);

        return ReactionStateResource::of($reactable, (string) $target->getKey(), $reaction);
    }

    /**
     * Take my reaction back.
     *
     * Any id answers 200 with my_reaction null, also for an item that went private or was deleted.
     */
    public function destroy(Request $request, string $id, Unreact $action): ReactionStateResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('delete', Reaction::class);

        $reactable = self::type($request);
        $action->handle($user, $reactable, $id);

        return ReactionStateResource::of($reactable, strtolower($id), null);
    }

    /**
     * Who reacted (owner only).
     *
     * Newest first, with `meta.summary` (counts by kind and in total). Members the owner may no longer see are left out of the list;
     * the summary counts every reaction. Anybody but the owner: 403; an item the viewer may not see: 404.
     */
    public function index(SocialListRequest $request, string $id, Reactions $reactions, VisibleBuilds $builds): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        $target = $this->target(self::type($request), $id);

        if ($target === null || ! Gate::allows('view', $target)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('viewAny', [Reaction::class, $target]);

        $query = Reaction::query()
            ->where('reactable_type', $target->getMorphClass())
            ->where('reactable_id', (string) $target->getKey())
            ->whereHas('user', fn ($member) => $member->whereNull('users.deleted_at')->where('users.status', UserStatus::Active->value)->whereNotNull('users.email_verified_at')
                // 09 §8.19: a sample member's reaction leaves the list with the samples.
                ->when(! $builds->samplesVisible(), fn ($hidden) => $hidden->where('users.is_sample', false)))
            ->with('user.avatar')
            ->orderByDesc('reactions.updated_at')
            ->orderByDesc('reactions.id');

        $builds->withoutBlocks($query->getQuery(), $user, 'reactions.user_id');

        return ReactionRowResource::collection($query->cursorPaginate($request->pageSize())->withQueryString())
            ->additional(['meta' => ['summary' => $reactions->summary($target)]]);
    }

    /**
     * vehicles or build-updates: one route per item type, which carries it as a route default.
     */
    private static function type(Request $request): ReactableType
    {
        return ReactableType::from((string) $request->route('type'));
    }

    private function target(ReactableType $type, string $id): Vehicle|BuildUpdate|null
    {
        if (preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $id) !== 1) {
            return null;
        }

        return match ($type) {
            ReactableType::Vehicle => Vehicle::query()->find(strtolower($id)),
            ReactableType::BuildUpdate => BuildUpdate::query()->find(strtolower($id)),
        };
    }
}
