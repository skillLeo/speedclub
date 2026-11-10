<?php

namespace App\Http\Resources\V1;

use App\Enums\ConversationFolder;
use App\Enums\InboxFolder;
use App\Services\Messaging\ConversationView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A row of MSG-01 (m2.4-contract §2 and Addendum).
 *
 * @property ConversationView $resource
 */
class ConversationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $view = $this->resource;
        $me = $view->me;
        $preview = $view->preview;

        return [
            'id' => $view->conversation->id,
            /** chats, requests, or archived (a chat with archived_at). */
            'folder' => match (true) {
                $me->archived_at !== null => InboxFolder::Archived,
                $me->folder === ConversationFolder::Requests => InboxFolder::Requests,
                default => InboxFolder::Chats,
            },
            'other' => $view->otherDeleted() || $view->otherUser === null ? null : new MemberSummaryResource($view->otherUser),
            /** The other account is gone: "Gelöschtes Mitglied". */
            'other_deleted' => $view->otherDeleted(),
            /** The context card: the vehicle of the latest start from a vehicle page, while you may view it. */
            'vehicle' => $view->vehicle === null ? null : new ChatVehicleResource($view->vehicle),
            'last_message' => $preview === null ? null : new MessagePreviewResource($preview, $preview->sender_id === $me->user_id),
            'unread_count' => $me->unread_count,
            /** Muted now: with no end ("Bis du es wieder änderst", muted_until null) or until muted_until. */
            'muted' => $me->isMuted(),
            /** The end of a timed mute; null when not muted or muted with no end. */
            'muted_until' => $me->muted_indefinitely ? null : $me->muted_until?->toIso8601ZuluString(),
            'pinned_at' => $me->pinned_at?->toIso8601ZuluString(),
            'archived_at' => $me->archived_at?->toIso8601ZuluString(),
            /** You may write here now. */
            'can_send' => $view->cannotSend === null,
            /** Why not, when can_send is false: recipient_closed (also a block), not_verified, restricted. */
            'cannot_send_reason' => $view->cannotSend,
            /**
             * Your request waits for the other member: your one message is out, a second answers 409 request_pending. Never tells
             * whether it was read or declined.
             */
            'request_pending' => $view->requestPending,
            'updated_at' => ($me->getAttribute('last_message_at') ?? $view->conversation->updated_at)?->toIso8601ZuluString('millisecond'),
        ];
    }
}
