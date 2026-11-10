<?php

namespace App\Actions\Messaging;

use App\Enums\CannotMessageReason;
use App\Enums\ErrorCode;
use App\Enums\MediaCategory;
use App\Exceptions\ApiException;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Media;
use App\Models\User;
use App\Services\Media\MediaService;
use App\Services\Messaging\ChatMedia;
use App\Services\Messaging\Reach;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * POST conversations/{id}/media: a photo for a message, through the media pipeline (re-encoded, EXIF and GPS stripped, WebP variants,
 * blurhash, quota). It is held by the conversation (mediable conversation) until a message takes it (mediable message); media:prune
 * removes one no message took within unused_photo_hours.
 */
class UploadMessagePhoto
{
    public function __construct(
        private readonly MediaService $media,
        private readonly Reach $reach,
        private readonly DeliverMessage $deliver,
    ) {}

    public function handle(User $member, ConversationParticipant $me, UploadedFile $file): Media
    {
        $this->assertMaySend($member, $me);
        $bytes = $this->media->inspectUpload($file);

        $reserved = DB::transaction(function () use ($member, $me, $bytes): Media {
            // The member's row first, as every upload: the quota check then sees parallel uploads.
            User::query()->whereKey($member->id)->lockForUpdate()->value('id');
            $conversation = Conversation::query()->whereKey($me->conversation_id)->firstOrFail();

            return $this->media->reserve($member, $conversation, ['category' => MediaCategory::Other], strlen($bytes), ChatMedia::disk());
        });

        return $this->media->processOrQueue($reserved, $bytes);
    }

    /**
     * The send rules before any storage is spent: who may write (403 cannot_message), and a sender whose request already holds its one
     * message cannot add a photo to it (409 request_pending, review #24).
     */
    private function assertMaySend(User $member, ConversationParticipant $me): void
    {
        [$reason, $other, , $follows] = $this->reach->check($member, $me);

        if ($reason !== null || $other === null) {
            throw DeliverMessage::cannotMessage($reason ?? CannotMessageReason::RecipientClosed);
        }

        $conversation = Conversation::query()->whereKey($me->conversation_id)->firstOrFail();

        if ($other->accepted_at === null && ! $follows && $this->deliver->requestCarriesMessage($conversation, $member, $other)) {
            throw new ApiException(ErrorCode::RequestPending);
        }
    }
}
