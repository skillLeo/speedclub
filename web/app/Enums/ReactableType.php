<?php

namespace App\Enums;

/**
 * What a member can react to (09 §11 `{type}/{id}/reactions`): the path segment, and the morph name stored in reactions.reactable_type.
 */
enum ReactableType: string
{
    case Vehicle = 'vehicles';
    case BuildUpdate = 'build-updates';

    public function morph(): string
    {
        return match ($this) {
            self::Vehicle => 'vehicle',
            self::BuildUpdate => 'build_update',
        };
    }
}
