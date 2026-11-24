<?php

namespace App\Http\Controllers\Api\V1\Forum;

use App\Actions\Forum\DeleteForumPost;
use App\Actions\Forum\PostForumReply;
use App\Actions\Forum\UpdateForumPost;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Forum\ForumPostListRequest;
use App\Http\Requests\Api\V1\Forum\StoreForumPostRequest;
use App\Http\Resources\V1\Forum\ForumPostResource;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumListing;
use App\Services\Forum\ForumReads;
use App\Support\Viewer;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * M5.8 replies of FOR-03 (m5.8-contract §4): one level of answers, "Hilfreich" counts (shown in the forum only), the author's edit and
 * delete. Reports go through POST reports {target_type: forum_post}.
 */
class ForumPostController extends Controller
{
    /**
     * List the replies of a thread.
     *
     * Guests too. Top-level replies (`sort` oldest by default, or helpful: the most "Hilfreich" first), each with up to 100 answers, oldest
     * first. Replies of members the reader blocked or who blocked the reader are left out; the reader's own pending replies are in, with
     * `status` pending.
     *
     * @unauthenticated
     */
    public function index(ForumPostListRequest $request, ForumThread $thread, ForumListing $listing): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);

        if (! Gate::forUser($viewer)->allows('view', $thread)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $page = $listing->replies($thread, $viewer, $request->sort(), $request->pageSize());
        ForumReads::primePosts($request, $page->items());

        return ForumPostResource::collection($page);
    }

    /**
     * Reply in a thread.
     *
     * Accepts an Idempotency-Key header. 60 a day. `parent_id` answers a reply (an answer to an answer joins its thread). A locked thread,
     * or one not published yet: 409 forum_thread_closed. New or unverified accounts: `status` pending (pre-moderation). A blocked term:
     * 422 content_blocked.
     */
    public function store(StoreForumPostRequest $request, ForumThread $thread, PostForumReply $reply): ForumPostResource
    {
        /** @var User $user */
        $user = $request->user();

        if (! Gate::allows('view', $thread)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('create', ForumThread::class);

        if (! $thread->isPublished() || $thread->is_locked) {
            throw new ApiException(ErrorCode::ForumThreadClosed);
        }

        $parent = null;

        if ($request->filled('parent_id')) {
            $parent = ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', false)->find($request->string('parent_id')->lower()->value());

            if (! $parent instanceof ForumPost || ! Gate::allows('view', $parent) || ! $parent->isPublished()) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['parent_id' => [(string) __('forum.reply_elsewhere')]]);
            }
        }

        $post = $reply->handle($user, $thread, $request->string('body')->value(), $parent);

        /** @status 201 */
        return new ForumPostResource($post->load('user.avatar'));
    }

    /**
     * Edit a forum post.
     *
     * Its author only (the opening post too: its text is the thread's). The edit is marked.
     */
    public function update(StoreForumPostRequest $request, ForumPost $post, UpdateForumPost $update): ForumPostResource
    {
        $this->ensureVisible($post);
        Gate::authorize('update', $post);

        return new ForumPostResource($update->handle($post, $request->string('body')->value())->load(['user.avatar', 'thread']));
    }

    /**
     * Delete a forum reply.
     *
     * Its author only, also under a restriction. Answers to it stay. The opening post goes with its thread. Answers 204.
     */
    public function destroy(ForumPost $post, DeleteForumPost $delete): Response
    {
        $this->ensureVisible($post);
        Gate::authorize('delete', $post);
        $delete->handle($post);

        return response()->noContent();
    }

    private function ensureVisible(ForumPost $post): void
    {
        if (! Gate::allows('view', $post)) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }
}
