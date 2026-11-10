<?php

namespace App\Http\Resources\V1;

use App\Enums\MessageType;
use App\Models\Message;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The last message on an MSG-01 row. A photo or a vehicle comes typed with a null body; the app writes "Foto" or "Fahrzeug".
 *
 * @property Message $resource
 */
class MessagePreviewResource extends JsonResource
{
    private const PREVIEW_LENGTH = 140;

    public function __construct(Message $resource, private readonly bool $mine)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $message = $this->resource;
        $body = $message->type === MessageType::Text ? $message->body : null;

        return [
            'id' => $message->id,
            'type' => $message->type,
            /** The start of a text, on one line; null for a photo or a vehicle. */
            'body' => $body === null ? null : mb_substr((string) preg_replace('/\s+/u', ' ', trim($body)), 0, self::PREVIEW_LENGTH),
            'is_mine' => $this->mine,
            'created_at' => $message->created_at->toIso8601ZuluString('millisecond'),
        ];
    }
}
