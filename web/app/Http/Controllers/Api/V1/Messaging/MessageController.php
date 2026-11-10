<?php

namespace App\Http\Controllers\Api\V1\Messaging;

use App\Actions\Messaging\HideMessage;
use App\Actions\Messaging\ReactToMessage;
use App\Actions\Messaging\SendMessage;
use App\Actions\Messaging\UploadMessagePhoto;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\Idempotency;
use App\Http\Requests\Api\V1\Messaging\ReactRequest;
use App\Http\Requests\Api\V1\Messaging\SendMessageRequest;
use App\Http\Requests\Api\V1\Messaging\ThreadRequest;
use App\Http\Requests\Api\V1\Messaging\UploadMessagePhotoRequest;
use App\Http\Resources\V1\ChatMediaResource;
use App\Http\Resources\V1\MessageResource;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Services\Messaging\Conversations;
use App\Services\Messaging\MessageViews;
use App\Services\Messaging\Thread;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;

/**
 * MSG-02's messages (m2.4-contract §2). 404 for a conversation or a message the member does not see, never 403.
 */
class MessageController extends Controller
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly MessageViews $views,
    ) {}

    /**
     * List messages of a conversation.
     *
     * Without parameters the newest page, newest first. `before` pages back (newest first, `limit` ≤ 50). `after` returns newer
     * messages, oldest first (`limit` ≤ 100): the app polls it every 3 s with the thread open, and an idle poll answers 304 to
     * `If-None-Match`. `meta.has_more`: more lie beyond this page in its direction.
     */
    public function index(ThreadRequest $request, string $conversation, Thread $thread): AnonymousResourceCollection
    {
        $member = $this->member($request);
        $participant = $this->participant($member, $conversation);
        [$messages, $more] = $thread->page($participant, $request->beforeId(), $request->afterId(), $request->limit());

        return MessageResource::collection($this->views->build($member, $messages))->additional(['meta' => ['has_more' => $more]]);
    }

    /**
     * Send a message.
     *
     * `type` text (≤ 2000 characters), photo (`media_id` of `POST conversations/{id}/media`) or vehicle (`vehicle_id`). Send `client_id`
     * and an `Idempotency-Key`, both the same through every retry: a retry answers 200 with the first message and
     * `Idempotency-Replayed: true`; the same ids with another payload are 409 `idempotency_key_reused`. 30 a minute.
     * 403 `cannot_message` (`reason`), 409 `request_pending` (your request holds its one message), 422.
     */
    public function store(SendMessageRequest $request, string $conversation, SendMessage $action): MessageResource
    {
        $member = $this->member($request);
        $participant = $this->participant($member, $conversation);
        $delivery = $action->handle($member, $participant, $request->draft(), Idempotency::keyOf($request));

        return (new MessageResource($this->views->one($member, $delivery->message)))->delivered(true, $delivery->replayed);
    }

    /**
     * Upload a photo for a message.
     *
     * JPEG, PNG or WebP up to 15 MB, re-encoded without metadata. Send the answer's `id` as `media_id` with `type: photo`; an upload no
     * message uses is removed after 24 h.
     */
    public function upload(UploadMessagePhotoRequest $request, string $conversation, UploadMessagePhoto $action): ChatMediaResource
    {
        $member = $this->member($request);
        $participant = $this->participant($member, $conversation);

        /** @var UploadedFile $file */
        $file = $request->file('file');

        /** @status 201 */
        return (new ChatMediaResource($action->handle($member, $participant, $file)))->delivered(true, false);
    }

    /**
     * Delete a message for me.
     *
     * The other member keeps it.
     */
    public function destroy(Request $request, string $message, HideMessage $action): Response
    {
        $member = $this->member($request);
        [$participant, $found] = $this->message($member, $message);
        $action->handle($member, $participant, $found);

        return response()->noContent();
    }

    /**
     * React to a message.
     *
     * [SIG sig.msg_reactions] One of six keys; one reaction per member and message, a new one replaces yours.
     */
    public function react(ReactRequest $request, string $message, ReactToMessage $action): MessageResource
    {
        $member = $this->member($request);
        [$participant, $found] = $this->message($member, $message);
        $action->react($member, $participant, $found, $request->reaction());

        return new MessageResource($this->views->one($member, $found));
    }

    /**
     * Remove my reaction.
     *
     * [SIG sig.msg_reactions]
     */
    public function unreact(Request $request, string $message, ReactToMessage $action): MessageResource
    {
        $member = $this->member($request);
        [, $found] = $this->message($member, $message);
        $action->remove($member, $found);

        return new MessageResource($this->views->one($member, $found));
    }

    private function participant(User $member, string $conversation): ConversationParticipant
    {
        Gate::authorize('viewAny', Conversation::class);

        return $this->conversations->participantFor($member, $conversation) ?? throw new ApiException(ErrorCode::NotFound);
    }

    /**
     * @return array{0: ConversationParticipant, 1: Message}
     */
    private function message(User $member, string $message): array
    {
        Gate::authorize('viewAny', Conversation::class);

        return $this->conversations->messageFor($member, $message) ?? throw new ApiException(ErrorCode::NotFound);
    }

    private function member(Request $request): User
    {
        /** @var User $member */
        $member = $request->user();

        return $member;
    }
}
