<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer to removing a follower (PROF-04): the name as sent and the state, whatever stood behind the name (ADR-142 b).
 */
class FollowerRemovedResource extends JsonResource
{
    private string $username = '';

    public static function of(string $username): self
    {
        $state = new self(null);
        $state->username = $username;

        return $state;
    }

    /**
     * @return array{username: string, follows_you: false}
     */
    public function toArray(Request $request): array
    {
        return [
            'username' => $this->username,
            'follows_you' => false,
        ];
    }
}
