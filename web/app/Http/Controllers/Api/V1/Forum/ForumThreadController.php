<?php

namespace App\Http\Controllers\Api\V1\Forum;

use App\Actions\Forum\CreateForumThread;
use App\Actions\Forum\DeleteForumThread;
use App\Actions\Forum\UpdateForumThread;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Forum\ForumPageRequest;
use App\Http\Requests\Api\V1\Forum\ForumSearchRequest;
use App\Http\Requests\Api\V1\Forum\ForumSimilarRequest;
use App\Http\Requests\Api\V1\Forum\ForumThreadListRequest;
use App\Http\Requests\Api\V1\Forum\StoreForumThreadRequest;
use App\Http\Resources\V1\Forum\ForumThreadResource;
use App\Http\Resources\V1\Forum\ForumThreadRowResource;
use App\Models\ForumCategory;
use App\Models\ForumThread;
use App\Models\User;
use App\Services\Forum\ForumCategories;
use App\Services\Forum\ForumListing;
use App\Services\Forum\ForumThreadDetail;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * M5.8 forum threads (10 §7, m5.8-contract §4): FOR-01/02 lists, search, Home "Gerade im Forum", FOR-03 detail, FOR-04 create with
 * "Ähnliche Themen", the author's edit and delete, FOR-05. Flag `forum` (404 feature_disabled while off).
 */
class ForumThreadController extends Controller
{
    public function __construct(
        private readonly ForumListing $listing,
        private readonly ForumCategories $categories,
    ) {}

    /**
     * List forum threads.
     *
     * Guests too. `sort` active (default: pinned first, then the newest activity), new, unanswered (no reply yet), solved. `category` is a
     * slug (a parent includes its sub-categories); an unknown or closed one answers 404. Threads of members the reader blocked, or who
     * blocked the reader, are left out.
     *
     * @unauthenticated
     */
    public function index(ForumThreadListRequest $request): AnonymousResourceCollection
    {
        $category = $this->category($request->string('category')->value());

        return ForumThreadRowResource::collection($this->listing->threads(
            Viewer::from($request),
            $category,
            $request->filled('tag') ? $request->string('tag')->value() : null,
            $request->sort(),
            $request->pageSize(),
        ));
    }

    /**
     * Search the forum.
     *
     * Guests too. Every word of `q` must start a word of the title, the opening text, the tags, the category or the attached build;
     * the order is `sort` (default active).
     *
     * @unauthenticated
     */
    public function search(ForumSearchRequest $request): AnonymousResourceCollection
    {
        return ForumThreadRowResource::collection($this->listing->search(
            Viewer::from($request),
            $request->words(),
            $this->category($request->string('category')->value()),
            $request->sort(),
            $request->pageSize(),
        ));
    }

    /**
     * "Gerade im Forum".
     *
     * Guests too. Home's module: up to 3 threads with the newest activity of the last 14 days; empty when the forum is quiet.
     *
     * @unauthenticated
     */
    public function active(ForumPageRequest $request): AnonymousResourceCollection
    {
        return ForumThreadRowResource::collection($this->listing->active(Viewer::from($request)));
    }

    /**
     * "Ähnliche Themen".
     *
     * FOR-04 while typing the title: up to 5 threads whose titles share the most words with it (threads of the chosen category first).
     */
    public function similar(ForumSimilarRequest $request): AnonymousResourceCollection
    {
        $category = $this->categories->open($request->string('category')->value());

        return ForumThreadRowResource::collection($this->listing->similar(Viewer::from($request), $request->string('title')->value(), $category));
    }

    /**
     * Show a forum thread.
     *
     * Guests too. A thread the reader may not see (pending or rejected of somebody else, removed, of a blocked member, a hidden sample)
     * answers 404; its author sees it in every state with `status`. A merged thread answers with `merged_into`.
     *
     * @unauthenticated
     */
    public function show(Request $request, ForumThread $thread): ForumThreadResource
    {
        if (! Gate::forUser(Viewer::from($request))->allows('view', $thread)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new ForumThreadResource(ForumThreadDetail::load($thread));
    }

    /**
     * Start a forum thread.
     *
     * Accepts an Idempotency-Key header. 5 a day. New accounts (under 3 days) and accounts without a confirmed e-mail post into
     * pre-moderation: `status` pending, visible to the author only until the team approves it. A blocked term: 422 content_blocked.
     * A publishing or forum restriction: 403 account_restricted.
     */
    public function store(StoreForumThreadRequest $request, CreateForumThread $create): ForumThreadResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('create', ForumThread::class);

        $category = $this->categories->open($request->string('category')->value());

        if (! $category instanceof ForumCategory) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['category' => [(string) __('forum.category_unknown')]]);
        }

        $thread = $create->handle(
            $user,
            $category,
            $request->string('title')->value(),
            $request->string('body')->value(),
            $request->tags(),
            $request->filled('vehicle_id') ? $request->string('vehicle_id')->value() : null,
            $request->filled('modification_id') ? $request->string('modification_id')->value() : null,
            $request->filled('product_id') ? $request->string('product_id')->value() : null,
        );

        /** @status 201 */
        return new ForumThreadResource(ForumThreadDetail::load($thread));
    }

    /**
     * Edit a forum thread.
     *
     * The author only: title, text, category, tags and attachments (each optional; null takes an attachment off). The edit is marked.
     */
    public function update(StoreForumThreadRequest $request, ForumThread $thread, UpdateForumThread $update): ForumThreadResource
    {
        /** @var User $user */
        $user = $request->user();
        $this->ensureVisible($thread);
        Gate::authorize('update', $thread);

        $changes = $request->safe()->only(['title', 'body', 'vehicle_id', 'modification_id', 'product_id']);

        if ($request->has('tags')) {
            $changes['tags'] = $request->tags();
        }

        if ($request->filled('category')) {
            $category = $this->categories->open($request->string('category')->value());

            if (! $category instanceof ForumCategory) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['category' => [(string) __('forum.category_unknown')]]);
            }

            $changes['category'] = $category;
        }

        /** @var array{title?: string, body?: string, tags?: list<string>, category?: ForumCategory, vehicle_id?: string|null, modification_id?: string|null, product_id?: string|null} $changes */
        return new ForumThreadResource(ForumThreadDetail::load($update->handle($user, $thread, $changes)));
    }

    /**
     * Delete a forum thread.
     *
     * The author only, also under a restriction, while no other member replied (else 409 forum_thread_has_replies). Answers 204.
     */
    public function destroy(ForumThread $thread, DeleteForumThread $delete): Response
    {
        $this->ensureVisible($thread);
        Gate::authorize('delete', $thread);
        $delete->handle($thread);

        return response()->noContent();
    }

    /**
     * My forum threads.
     *
     * FOR-05 "Meine Themen": every thread the member started, in every state but deleted (pending, rejected with its reason in the
     * detail, removed, merged), newest first.
     */
    public function mine(ForumPageRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return ForumThreadRowResource::collection($this->listing->mine($user, $request->pageSize()));
    }

    /**
     * My forum subscriptions.
     *
     * FOR-05 "Abonniert": subscribed threads the member may see, newest activity first.
     */
    public function subscriptions(ForumPageRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return ForumThreadRowResource::collection($this->listing->subscriptions($user, $request->pageSize()));
    }

    private function category(string $slug): ?ForumCategory
    {
        if ($slug === '') {
            return null;
        }

        return $this->categories->open($slug) ?? throw new ApiException(ErrorCode::NotFound);
    }

    private function ensureVisible(ForumThread $thread): void
    {
        if (! Gate::allows('view', $thread)) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }
}
