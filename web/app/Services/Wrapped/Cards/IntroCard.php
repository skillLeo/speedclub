<?php

namespace App\Services\Wrapped\Cards;

use App\Services\Wrapped\WrappedContext;

/**
 * Card 1: "Deine Saison 2027" / "Dein Jahr 2027". Always present; its words come from lang/{de,en}/wrapped.php per request. Its photo
 * (ADR-516 a, `media_id`) is the lead car's first usable photo, the one the share card shows, handed out by
 * WrappedPayloadBuilder::assignPhotos; without a share card (no published car) or a usable photo the intro stays typographic.
 */
final class IntroCard implements WrappedCard
{
    public function kind(): string
    {
        return 'intro';
    }

    public function build(WrappedContext $context): array
    {
        return ['kind' => 'intro', 'year' => $context->season->year, 'season' => $context->season->kind];
    }
}
