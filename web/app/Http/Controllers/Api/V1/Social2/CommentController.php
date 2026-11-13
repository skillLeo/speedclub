<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\DeleteComment;
use App\Actions\Social\PostComment;
use App\Actions\Social\SetVehicleComments;
use App\Enums\CommentStatus;
use App\Enums\ErrorCode;
use App\Enums\UserStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\SetVehicleCommentsRequest;
use App\Http\Requests\Api\V1\Social2\SocialListRequest;
use App\Http\Requests\Api\V1\Social2\StoreCommentRequest;
use App\Http\Resources\V1\CommentResource;
use App\Http\Resources\V1\VehicleSocialResource;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Support\Viewer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Comments on build updates (09 §8.5, flag build_comments, off by default: moderation capacity first). Flat with one reply level,
 * at most 500 characters, keyword rules, 30 an hour, reportable through POST reports (target_type comment), notifications to the update's
 * owner and to the member replied to. While the flag is off every route answers 404 feature_disabled.
 */
class CommentController extends Controller
{
    /**
     * List the comments of a build update.
     *
     * Guests too. Top-level comments oldest first, each with its replies. Comments of members the viewer may not see (blocked either
     * way, suspended, gone, samples while hidden) and removed ones are left out.
     *
     * @unauthenticated
     */
    public function index(SocialListRequest $request, BuildUpdate $update, VisibleBuilds $builds): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);

        if (! Gate::forUser($viewer)->allows('view', $update)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $visible = function (Builder $query) use ($viewer, $builds): Builder {
            $query->where('comments.status', CommentStatus::Visible->value)
                ->whereHas('user', fn (Builder $author) => $author->whereNull('users.deleted_at')->where('users.status', UserStatus::Active->value)->whereNotNull('users.email_verified_at')
                    ->when(! $builds->samplesVisible(), fn (Builder $hidden) => $hidden->where('users.is_sample', false)));
            $builds->withoutBlocks($query->getQuery(), $viewer, 'comments.user_id');

            return $query;
        };

        $page = $visible(Comment::query()->where('build_update_id', $update->getKey())->whereNull('parent_id'))
            ->with(['user.avatar', 'buildUpdate.vehicle', 'visibleReplies' => fn (Relation $replies) => $visible($replies->getQuery())->with(['user.avatar', 'buildUpdate.vehicle'])->orderBy('created_at')->orderBy('id')])
            ->orderBy('comments.created_at')
            ->orderBy('comments.id')
            ->cursorPaginate($request->pageSize())
            ->withQueryString();

        return CommentResource::collection($page);
    }

    /**
     * Comment on a build update.
     *
     * Accepts an Idempotency-Key header. `parent_id` replies (a reply to a reply joins its thread). Comments turned off for the vehicle:
     * 403 comments_disabled. Unverified: 403 email_not_verified. A blocked term: 422 content_blocked.
     */
    public function store(StoreCommentRequest $request, BuildUpdate $update, PostComment $action): CommentResource
    {
        /** @var User $user */
        $user = $request->user();

        if (! Gate::allows('view', $update)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('comment', $update);

        $parent = null;

        if ($request->filled('parent_id')) {
            $parent = Comment::query()->where('build_update_id', $update->getKey())->find($request->string('parent_id')->lower()->toString());

            if (! $parent instanceof Comment || ! Gate::allows('view', $parent)) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['parent_id' => [(string) __('social.comments.reply_elsewhere')]]);
            }
        }

        $comment = $action->handle($user, $update, $request->string('body')->toString(), $parent);

        /** @status 201 */
        return new CommentResource($comment->load(['user.avatar', 'buildUpdate.vehicle']));
    }

    /**
     * Delete a comment.
     *
     * Its author, or the owner of the update; also under a restriction. Replies go with a top-level comment. Answers 204.
     */
    public function destroy(Comment $comment, DeleteComment $action): Response
    {
        Gate::authorize('delete', $comment);

        $action->handle($comment);

        return response()->noContent();
    }

    /**
     * Turn comments on a vehicle on or off.
     *
     * Owner only. Off stops new comments; what was written stays. Answers the vehicle's social block.
     */
    public function settings(SetVehicleCommentsRequest $request, Vehicle $vehicle, SetVehicleComments $action): VehicleSocialResource
    {
        Gate::authorize('delete', $vehicle);

        return new VehicleSocialResource($action->handle($vehicle, $request->boolean('enabled')));
    }
}
