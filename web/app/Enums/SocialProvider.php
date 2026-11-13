<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Identity providers whose ID tokens the server verifies itself (ADR-408).
 */
enum SocialProvider: string
{
    use HasLabel;

    case Apple = 'apple';
    case Google = 'google';

    /** The flag of 09 §8.18 that switches the provider on. */
    public function flag(): string
    {
        return 'auth.'.$this->value;
    }
}
