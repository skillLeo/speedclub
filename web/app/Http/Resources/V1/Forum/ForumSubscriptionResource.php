<?php

namespace App\Http\Resources\V1\Forum;

use App\Models\ForumThread;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Whether the member follows a thread's replies (FOR-03 "Abonnieren").
 *
 * @property array{thread: ForumThread, subscribed: bool} $resource
 */
class ForumSubscriptionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var string */
            'thread_id' => $this->resource['thread']->id,
            /** @var bool */
            'subscribed' => $this->resource['subscribed'],
        ];
    }
}
