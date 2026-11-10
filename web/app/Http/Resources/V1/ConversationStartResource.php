<?php

namespace App\Http\Resources\V1;

use App\Http\Resources\Concerns\AnswersDelivery;
use App\Services\Messaging\ConversationView;
use App\Services\Messaging\MessageView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer of POST conversations: the conversation (new or the pair's existing one) and the message just sent.
 *
 * @property array{conversation: ConversationView, message: MessageView} $resource
 */
class ConversationStartResource extends JsonResource
{
    use AnswersDelivery;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'conversation' => new ConversationDetailResource($this->resource['conversation']),
            'message' => new MessageResource($this->resource['message']),
        ];
    }
}
