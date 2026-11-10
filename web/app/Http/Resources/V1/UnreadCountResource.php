<?php

namespace App\Http\Resources\V1;

use App\Services\Notifications\UnreadCounts;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Tab badges and the bell of HOME-01 (M2.2); messages and requests since M2.4.
 *
 * @property UnreadCounts $resource
 */
class UnreadCountResource extends JsonResource
{
    /**
     * @return array<string, int>
     */
    public function toArray(Request $request): array
    {
        return [
            /** Unread rows of HOME-02. */
            'notifications' => $this->resource->notifications,
            /** Unread messages in Chats, muted and archived conversations left out (M2.4). */
            'messages' => $this->resource->messages,
            /** Open message requests (M2.4). */
            'requests' => $this->resource->requests,
        ];
    }
}
