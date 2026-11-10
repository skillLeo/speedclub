<?php

namespace App\Enums;

/**
 * What a catalogue Action, a merge or a slug lookup is about (M3.3).
 */
enum CatalogLevel: string
{
    case Make = 'make';
    case Model = 'model';
    case Generation = 'generation';
    case Brand = 'brand';

    /** The vehicles column that points at this level; null for brands (modifications.brand_id). */
    public function vehicleColumn(): ?string
    {
        return match ($this) {
            self::Make => 'make_id',
            self::Model => 'model_id',
            self::Generation => 'generation_id',
            self::Brand => null,
        };
    }
}
