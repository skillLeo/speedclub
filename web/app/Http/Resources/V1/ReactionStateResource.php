<?php

namespace App\Http\Resources\V1;

use App\Enums\ReactableType;
use App\Enums\ReactionType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer of PUT/DELETE {type}/{id}/reactions: the viewer's own reaction only, never a count (09 §8.5).
 */
class ReactionStateResource extends JsonResource
{
    private ReactableType $type = ReactableType::BuildUpdate;

    private string $id = '';

    private ?ReactionType $reaction = null;

    public static function of(ReactableType $type, string $id, ?ReactionType $reaction): self
    {
        $state = new self(null);
        $state->type = $type;
        $state->id = $id;
        $state->reaction = $reaction;

        return $state;
    }

    /**
     * @return array{target_type: ReactableType, target_id: string, my_reaction: 'strong'|'clean'|'low'|'loud'|null}
     */
    public function toArray(Request $request): array
    {
        return [
            /** vehicles or build-updates, as in the path. */
            'target_type' => $this->type,
            'target_id' => $this->id,
            'my_reaction' => $this->reaction?->value,
        ];
    }
}
