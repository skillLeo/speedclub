<?php

namespace App\Http\Controllers\Api\V1\Forum;

use App\Actions\Forum\MarkForumSolution;
use App\Actions\Forum\SubscribeForumThread;
use App\Actions\Forum\VoteForumPost;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Forum\SetForumSolutionRequest;
use App\Http\Resources\V1\Forum\ForumSubscriptionResource;
use App\Http\Resources\V1\Forum\ForumThreadResource;
use App\Http\Resources\V1\Forum\ForumVoteResource;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumThreadDetail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * M5.8 FOR-03 interactions: "Hilfreich" votes (count shown in the forum only, ADR-506), "Gelöst" by the thread's author, subscriptions.
 */
class ForumInteractionController extends Controller
{
    /**
     * Mark a reply as helpful.
     *
     * Idempotent. Not one's own (422 own_content), not the opening post; a reply the member may not see: 404.
     */
    public function vote(Request $request, ForumPost $post, VoteForumPost $votes): ForumVoteResource
    {
        /** @var User $user */
        $user = $request->user();
        $this->ensureVisible($post);

        if ($post->user_id === $user->id) {
            throw new ApiException(ErrorCode::OwnContent);
        }

        Gate::authorize('vote', $post);

        return new ForumVoteResource(['post' => $votes->vote($user, $post), 'voted' => true]);
    }

    /**
     * Take a "Hilfreich" back.
     *
     * Idempotent; also under a restriction.
     */
    public function unvote(Request $request, ForumPost $post, VoteForumPost $votes): ForumVoteResource
    {
        /** @var User $user */
        $user = $request->user();
        $this->ensureVisible($post);

        return new ForumVoteResource(['post' => $votes->unvote($user, $post), 'voted' => false]);
    }

    /**
     * Mark the solution.
     *
     * The thread's author: one published reply of this thread is "Gelöst" (another one replaces it). Its author is told.
     */
    public function solve(SetForumSolutionRequest $request, ForumThread $thread, MarkForumSolution $mark): ForumThreadResource
    {
        $this->ensureThread($thread);
        Gate::authorize('markSolution', $thread);

        $post = ForumPost::query()->where('thread_id', $thread->id)->find($request->string('post_id')->lower()->value());

        if (! $post instanceof ForumPost || ! Gate::allows('view', $post)) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['post_id' => [(string) __('forum.solution.invalid')]]);
        }

        return new ForumThreadResource(ForumThreadDetail::load($mark->handle($thread, $post)));
    }

    /**
     * Clear the solution.
     *
     * The thread's author.
     */
    public function unsolve(ForumThread $thread, MarkForumSolution $mark): ForumThreadResource
    {
        $this->ensureThread($thread);
        Gate::authorize('markSolution', $thread);

        return new ForumThreadResource(ForumThreadDetail::load($mark->handle($thread, null)));
    }

    /**
     * Subscribe to a thread.
     *
     * Idempotent: new replies notify (forum_reply, SET-09 "Forum").
     */
    public function subscribe(Request $request, ForumThread $thread, SubscribeForumThread $subscriptions): ForumSubscriptionResource
    {
        /** @var User $user */
        $user = $request->user();
        $this->ensureThread($thread);
        Gate::authorize('subscribe', $thread);

        return new ForumSubscriptionResource(['thread' => $thread, 'subscribed' => $subscriptions->subscribe($user, $thread)]);
    }

    /**
     * Unsubscribe from a thread.
     *
     * Idempotent.
     */
    public function unsubscribe(Request $request, ForumThread $thread, SubscribeForumThread $subscriptions): ForumSubscriptionResource
    {
        /** @var User $user */
        $user = $request->user();
        $this->ensureThread($thread);

        return new ForumSubscriptionResource(['thread' => $thread, 'subscribed' => $subscriptions->unsubscribe($user, $thread)]);
    }

    private function ensureVisible(ForumPost $post): void
    {
        if (! Gate::allows('view', $post)) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }

    private function ensureThread(ForumThread $thread): void
    {
        if (! Gate::allows('view', $thread)) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }
}
