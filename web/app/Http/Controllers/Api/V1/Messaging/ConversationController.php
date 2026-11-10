<?php

namespace App\Http\Controllers\Api\V1\Messaging;

use App\Actions\Messaging\AnswerRequest;
use App\Actions\Messaging\DeleteConversationForMe;
use App\Actions\Messaging\MarkConversationRead;
use App\Actions\Messaging\OrganiseConversation;
use App\Actions\Messaging\SignalTyping;
use App\Actions\Messaging\StartConversation;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\Idempotency;
use App\Http\Requests\Api\V1\Messaging\InboxRequest;
use App\Http\Requests\Api\V1\Messaging\MarkReadRequest;
use App\Http\Requests\Api\V1\Messaging\OrganiseConversationRequest;
use App\Http\Requests\Api\V1\Messaging\StartConversationRequest;
use App\Http\Resources\V1\ConversationDetailResource;
use App\Http\Resources\V1\ConversationResource;
use App\Http\Resources\V1\ConversationStartResource;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\PublicMembers;
use App\Services\Messaging\Conversations;
use App\Services\Messaging\ConversationViews;
use App\Services\Messaging\Inbox;
use App\Services\Messaging\MessageViews;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * MSG-01, MSG-02's header, MSG-04 and MSG-05 (m2.4-contract §2). Every route answers 404 for a conversation the member is not an active
 * participant of (deleted for them, closed by a block either way, someone else's, unknown), never 403.
 */
class ConversationController extends Controller
{
    public function __construct(
        private readonly Conversations $conversations,
        private readonly ConversationViews $views,
    ) {}

    /**
     * List my conversations.
     *
     * `folder`: chats (default), requests, archived. Pinned first, then the newest message. `q` [SIG sig.msg_organize] finds the other
     * member's name or words of a message you can see. The app polls this every 15 s with the inbox open.
     */
    public function index(InboxRequest $request, Inbox $inbox, FeatureFlags $flags): AnonymousResourceCollection
    {
        $member = $this->member($request);
        Gate::authorize('viewAny', Conversation::class);
        $words = $flags->enabled('sig.msg_organize') ? $request->words() : [];

        return ConversationResource::collection($inbox->page($member, $request->folder(), $words, $request->pageSize(), $request->validated('cursor')));
    }

    /**
     * Start a conversation.
     *
     * With the first message, a text or a vehicle card; `vehicle_id` sets the context card (VEH-01 "Nachricht"). The pair's existing
     * conversation is reused (200); a new one answers 201. A member who does not follow you gets it as a request (one message until
     * accepted). 20 a day, of them 10 requests. Send `client_id` and an `Idempotency-Key`; a retry returns the first message.
     * 403 `cannot_message` with `reason` (recipient_closed, also for a block, not_verified, restricted), 404 `member_unavailable`,
     * 409 `request_pending`, 422 (yourself, a vehicle you cannot view).
     */
    public function store(StartConversationRequest $request, StartConversation $action, PublicMembers $members, MessageViews $messages): ConversationStartResource
    {
        $member = $this->member($request);
        Gate::authorize('viewAny', Conversation::class);
        $recipient = $members->find($request->recipient());

        if (! $recipient instanceof User || ! $recipient->isPubliclyVisible()) {
            throw new ApiException(ErrorCode::MemberUnavailable);
        }

        if ($recipient->is($member)) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['recipient' => [(string) __('messaging.recipient_self')]]);
        }

        $delivery = $action->handle($member, $recipient, $request->contextVehicleId(), $request->draft(), Idempotency::keyOf($request));
        $participant = $this->conversations->participantFor($member, $delivery->participant->conversation_id) ?? $delivery->participant;

        return (new ConversationStartResource([
            'conversation' => $this->views->one($member, $participant),
            'message' => $messages->one($member, $delivery->message),
        ]))->delivered($delivery->created, $delivery->replayed);
    }

    /**
     * Show a conversation.
     *
     * With the context card, `other_typing` [SIG sig.msg_typing] and `other_read_message_id` [SIG sig.msg_read_receipts] (only when both
     * send read receipts and it is no request).
     */
    public function show(Request $request, string $conversation): ConversationDetailResource
    {
        $member = $this->member($request);

        return new ConversationDetailResource($this->views->one($member, $this->participant($member, $conversation)));
    }

    /**
     * Mute, pin or archive a conversation.
     *
     * [SIG sig.msg_organize] `muted` (true without `muted_until` mutes with no end, false unmutes), `muted_until` (until then; null
     * without `muted: true` unmutes), `pinned` (at most 5), `archived`. Chats only.
     */
    public function update(OrganiseConversationRequest $request, string $conversation, OrganiseConversation $action): ConversationDetailResource
    {
        $member = $this->member($request);
        $participant = $this->participant($member, $conversation);
        $action->handle($member, $participant, $request->changes(), $request->sentField());

        return new ConversationDetailResource($this->views->one($member, $this->participant($member, $conversation)));
    }

    /**
     * Delete a conversation for me.
     *
     * The other member keeps it. A later message of theirs brings it back, showing only what came after.
     */
    public function destroy(Request $request, string $conversation, DeleteConversationForMe $action): Response
    {
        $member = $this->member($request);
        $action->handle($member, $this->participant($member, $conversation));

        return response()->noContent();
    }

    /**
     * Mark read up to a message.
     *
     * Answers 204 and changes nothing for a request: its sender never learns that it was opened.
     */
    public function read(MarkReadRequest $request, string $conversation, MarkConversationRead $action): Response
    {
        $member = $this->member($request);
        $action->handle($member, $this->participant($member, $conversation), $request->messageId());

        return response()->noContent();
    }

    /**
     * Accept a message request.
     *
     * For the recipient of a request only; otherwise 404.
     */
    public function accept(Request $request, string $conversation, AnswerRequest $action): ConversationDetailResource
    {
        $member = $this->member($request);
        $action->accept($member, $this->participant($member, $conversation));

        return new ConversationDetailResource($this->views->one($member, $this->participant($member, $conversation)));
    }

    /**
     * Decline a message request.
     *
     * Hidden for you; the sender is not told. For the recipient of a request only; otherwise 404.
     */
    public function decline(Request $request, string $conversation, AnswerRequest $action): Response
    {
        $member = $this->member($request);
        $action->decline($member, $this->participant($member, $conversation));

        return response()->noContent();
    }

    /**
     * Say that I am typing.
     *
     * [SIG sig.msg_typing] Holds 5 s. At most 20 a minute.
     */
    public function typing(Request $request, string $conversation, SignalTyping $action): Response
    {
        $member = $this->member($request);
        $action->handle($member, $this->participant($member, $conversation));

        return response()->noContent();
    }

    private function participant(User $member, string $conversation): ConversationParticipant
    {
        Gate::authorize('viewAny', Conversation::class);

        return $this->conversations->participantFor($member, $conversation) ?? throw new ApiException(ErrorCode::NotFound);
    }

    private function member(Request $request): User
    {
        /** @var User $member */
        $member = $request->user();

        return $member;
    }
}
