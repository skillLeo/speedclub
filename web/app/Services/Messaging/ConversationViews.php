<?php

namespace App\Services\Messaging;

use App\Enums\CannotMessageReason;
use App\Enums\ConversationFolder;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Follow;
use App\Models\Message;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Discover\VisibleBuilds;
use App\Services\Social\MessagingEligibility;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * Builds ConversationView for a page of the inbox or one conversation, with a fixed number of queries per page.
 */
class ConversationViews
{
    public const VEHICLE_RELATIONS = ['make', 'vehicleModel', 'generation', 'cover', 'media', 'owner', 'specs'];

    public function __construct(
        private readonly MessagingEligibility $eligibility,
        private readonly FeatureFlags $flags,
        private readonly TypingSignals $typing,
        private readonly VisibleBuilds $builds,
    ) {}

    /**
     * @param  iterable<ConversationParticipant>  $rows  the viewer's participant rows
     * @return list<ConversationView>
     */
    public function build(User $viewer, iterable $rows, bool $detail = false): array
    {
        $rows = collect($rows)->values();

        if ($rows->isEmpty()) {
            return [];
        }

        $ids = $rows->pluck('conversation_id')->unique()->values()->all();
        $conversations = Conversation::query()->whereKey($ids)->with(['vehicle' => fn ($query) => $query->with(self::VEHICLE_RELATIONS)])->get()->keyBy('id');
        $others = ConversationParticipant::query()->whereIn('conversation_id', $ids)->where('user_id', '!=', $viewer->id)->get()->keyBy('conversation_id');
        $users = User::withTrashed()->with('avatar')->whereKey($others->pluck('user_id')->unique()->values()->all())->get()->keyBy('id');
        $this->mainVehicles($viewer, $users);
        $previews = $this->previews($rows);
        $followers = Follow::query()->where('followee_id', $viewer->id)->whereIn('follower_id', $users->keys()->all())->pluck('follower_id')->flip();
        $pending = $this->pendingRequests($viewer, $others);
        $receipts = $detail && $this->flags->enabled('sig.msg_read_receipts');
        $typing = $detail && $this->flags->enabled('sig.msg_typing');

        $views = [];

        foreach ($rows as $me) {
            /** @var Conversation $conversation */
            $conversation = $conversations->get($me->conversation_id);
            /** @var ConversationParticipant|null $other */
            $other = $others->get($me->conversation_id);
            $otherUser = $other === null ? null : $users->get($other->user_id);
            $otherUser = $otherUser instanceof User ? $otherUser : null;
            $vehicle = $conversation->vehicle;
            $requestPending = $pending->has($me->conversation_id);

            $views[] = new ConversationView(
                me: $me,
                other: $other,
                otherUser: $otherUser,
                conversation: $conversation,
                vehicle: $vehicle instanceof Vehicle && Gate::forUser($viewer)->allows('view', $vehicle) ? $vehicle : null,
                preview: $previews->get($me->conversation_id),
                cannotSend: $otherUser === null
                    ? CannotMessageReason::RecipientClosed
                    : $this->eligibility->reason($viewer, $otherUser, $followers->has($otherUser->id), accepted: $other?->accepted_at !== null, blocked: false),
                requestPending: $requestPending,
                otherTyping: $typing && $other !== null && ! $requestPending && ! $other->isPendingRequest() && $this->typing->isTyping($me->conversation_id, $other->user_id),
                otherReadMessageId: $receipts ? $this->otherRead($viewer, $me, $other, $otherUser) : null,
            );
        }

        return $views;
    }

    public function one(User $viewer, ConversationParticipant $me, bool $detail = true): ConversationView
    {
        return $this->build($viewer, [$me], $detail)[0];
    }

    /**
     * DQ-1086/1096: each partner's main build ("fährt BMW M3" under the name, the car badge on the avatar), only a build the viewer may
     * see in a list (VisibleBuilds: public, published, no block, samples only while shown); null otherwise. Two queries per page, set as
     * the `mainVehicle` relation that ConversationMemberResource reads.
     *
     * @param  Collection<string, User>  $users
     */
    private function mainVehicles(User $viewer, Collection $users): void
    {
        if ($users->isEmpty()) {
            return;
        }

        $mains = $this->builds->query($viewer)->whereIn('vs.owner_id', $users->keys()->all())->where('v.is_main', true)
            ->pluck('vs.vehicle_id', 'vs.owner_id')->map(strval(...))->all();
        $vehicles = $this->builds->vehicles(array_values($mains));

        foreach ($users as $id => $user) {
            $user->setRelation('mainVehicle', isset($mains[$id]) ? ($vehicles[$mains[$id]] ?? null) : null);
        }
    }

    /**
     * Read receipts apply only when both members send them and neither side is a request (02_PRODUCT_SPEC §3.6, MSG-04).
     */
    private function otherRead(User $viewer, ConversationParticipant $me, ?ConversationParticipant $other, ?User $otherUser): ?string
    {
        if ($other === null || $otherUser === null || $other->folder !== ConversationFolder::Chats || $me->folder !== ConversationFolder::Chats) {
            return null;
        }

        if ($viewer->getAttribute('read_receipts') === false || $otherUser->getAttribute('read_receipts') === false) {
            return null;
        }

        return $other->last_read_message_id;
    }

    /**
     * The newest message each row's member sees (the inbox selects it as preview_id; a single conversation asks here).
     *
     * @param  Collection<int, ConversationParticipant>  $rows
     * @return Collection<string, Message>
     */
    private function previews(Collection $rows): Collection
    {
        $ids = [];

        foreach ($rows as $row) {
            $id = $row->getAttribute('preview_id');

            if (! array_key_exists('preview_id', $row->getAttributes())) {
                $id = app(Conversations::class)->visibleMessages($row)->max('messages.id');
            }

            if (is_string($id)) {
                $ids[] = $id;
            }
        }

        return $ids === [] ? collect() : Message::query()->whereKey($ids)->get()->keyBy('conversation_id');
    }

    /**
     * Conversations in which the viewer's request waits for the other side (not accepted, possibly declined, which the viewer never
     * learns), and the viewer's one message is out after the other side's clearing point.
     *
     * @param  Collection<string, ConversationParticipant>  $others
     * @return Collection<string, bool>
     */
    private function pendingRequests(User $viewer, Collection $others): Collection
    {
        $waiting = $others->filter(fn (ConversationParticipant $other): bool => $other->isPendingRequest());

        if ($waiting->isEmpty()) {
            return collect();
        }

        $latest = Message::query()
            ->whereIn('conversation_id', $waiting->keys()->all())
            ->where('sender_id', $viewer->id)
            ->groupBy('conversation_id')
            ->selectRaw('conversation_id, MAX(id) as latest')
            ->pluck('latest', 'conversation_id');

        return $waiting
            ->filter(fn (ConversationParticipant $other, string $id): bool => $other->declined_at !== null || is_string($latest->get($id)) && ($other->cleared_before_message_id === null || strcmp((string) $latest->get($id), $other->cleared_before_message_id) > 0))
            ->map(fn (): bool => true);
    }
}
