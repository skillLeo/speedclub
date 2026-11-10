<?php

namespace App\Services\Discover;

/**
 * One understood filter as the DISC-02 chip row shows it ("BMW ×", "M4 ×", "19″ ×", "ab 500 PS ×").
 */
final readonly class InterpretationChip
{
    public function __construct(
        public string $field,
        public string $value,
        public string $label,
        public ?string $matched,
    ) {}
}
