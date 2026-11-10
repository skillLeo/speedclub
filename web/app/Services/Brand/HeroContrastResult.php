<?php

namespace App\Services\Brand;

/**
 * The ADR-129/151/152 check of a hero photo at one focal point: the contrast that 98 % of the pixels under the logo and under the
 * bottom text block reach in the worst reference frame. `passes` when both are at least 4.5:1.
 */
final readonly class HeroContrastResult
{
    public function __construct(
        public float $logoRatio,
        public float $textRatio,
        public string $frame,
        public float $minimum,
    ) {}

    public function passes(): bool
    {
        return $this->logoRatio >= $this->minimum && $this->textRatio >= $this->minimum;
    }

    /**
     * @return array{passes: bool, logo_ratio: float, text_ratio: float, frame: string, minimum: float}
     */
    public function toArray(): array
    {
        return [
            'passes' => $this->passes(),
            'logo_ratio' => round($this->logoRatio, 2),
            'text_ratio' => round($this->textRatio, 2),
            'frame' => $this->frame,
            'minimum' => $this->minimum,
        ];
    }
}
