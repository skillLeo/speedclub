<?php

namespace App\Services\Messaging;

use App\Models\Conversation;
use App\Models\Media;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\URL;

/**
 * Chat photos (lead ruling, M2.4 review #5): stored on the private disk (speedclub.messaging.media_disk), never on a public URL. A
 * reader gets signed URLs of GET chat-media/{media}/{width}?viewer={id}, valid for media_url_minutes rounded up to the next step (so
 * every poll inside a step renders the same URL and the thread keeps its 304). The route checks again on every fetch that the viewer
 * still sees the photo: the uploader while it waits in their conversation, afterwards every active participant who sees the message.
 */
class ChatMedia
{
    public function __construct(private readonly Conversations $conversations) {}

    public static function disk(): string
    {
        return config()->string('speedclub.messaging.media_disk');
    }

    /**
     * @return list<array{width: int, height: int, url: string}>
     */
    public function variants(Media $media, User $viewer): array
    {
        /** @var array<int|string, string> $paths */
        $paths = $media->getAttribute('variants') ?? [];
        $width = (int) $media->getAttribute('width');
        $height = (int) $media->getAttribute('height');
        $step = max(1, config()->integer('speedclub.messaging.media_url_minutes')) * 60;
        $expires = now()->setTimestamp((intdiv(now()->getTimestamp(), $step) + 2) * $step);
        $variants = [];

        foreach (array_keys($paths) as $variantWidth) {
            $variantWidth = (int) $variantWidth;
            $variants[] = [
                'width' => $variantWidth,
                'height' => $width > 0 ? (int) round($variantWidth * $height / $width) : 0,
                'url' => URL::temporarySignedRoute('api.v1.chat-media.show', $expires, ['media' => $media->id, 'width' => $variantWidth, 'viewer' => $viewer->id]),
            ];
        }

        usort($variants, fn (array $a, array $b): int => $a['width'] <=> $b['width']);

        return $variants;
    }

    public function allows(User $viewer, Media $media): bool
    {
        if ($media->trashed() || $viewer->isDeactivated() || ! $media->isUsablePhoto()) {
            return false;
        }

        $type = $media->getAttribute('mediable_type');
        $id = $media->getAttribute('mediable_id');

        if (! is_string($id)) {
            return false;
        }

        if ($type === (new Conversation)->getMorphClass()) {
            return $media->owner_id === $viewer->id && $this->conversations->participantFor($viewer, $id) !== null;
        }

        if ($type === (new Message)->getMorphClass()) {
            $found = $this->conversations->messageFor($viewer, $id);

            return $found !== null && $found[1]->media_id === $media->id;
        }

        return false;
    }
}
