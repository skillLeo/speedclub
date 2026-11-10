<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The answer to block and unblock: the name as sent and the viewer's own side, never whether it changed, and nothing about the other
 * member's side.
 */
class BlockStateResource extends JsonResource
{
    private string $username = '';

    private bool $isBlocked = false;

    public static function of(string $username, bool $isBlocked): self
    {
        $state = new self(null);
        $state->username = $username;
        $state->isBlocked = $isBlocked;

        return $state;
    }

    /**
     * @return array{username: string, is_blocked: bool}
     */
    public function toArray(Request $request): array
    {
        return [
            'username' => $this->username,
            /** @var bool */
            'is_blocked' => $this->isBlocked,
        ];
    }
}
