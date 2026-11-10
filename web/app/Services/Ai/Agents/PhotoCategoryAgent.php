<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;

/**
 * ai.photo_tagging: the 640 px variant of a member's own photo (EXIF gone since the upload) → one of the five photo categories.
 */
final class PhotoCategoryAgent extends SpeedClubAgent
{
    public const CATEGORIES = ['exterior', 'interior', 'engine', 'wheels', 'detail'];

    protected function task(): string
    {
        return <<<'TXT'
        You look at one photo of a car and say what it mainly shows: exterior (the car from outside), interior (cabin, seats, dashboard),
        engine (engine bay or engine parts), wheels (wheels, tyres, brakes) or detail (a close-up of any other part). Answer with one category.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'category' => $schema->string()->enum(self::CATEGORIES)->required(),
        ];
    }
}
