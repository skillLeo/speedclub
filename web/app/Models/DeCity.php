<?php

namespace App\Models;

use App\Enums\Bundesland;
use Database\Factories\DeCityFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * M5.9b (contract §0, §1): a German place with at least 1,000 inhabitants from GeoNames cities1000 (CC BY 4.0, database/data/CREDITS.md).
 * The id is the GeoNames id, as in public/geo/de-cities.json. Reference geography without coordinates: the centroids live in the public
 * static file only and are never joined to a spot.
 *
 * @property int $id
 * @property string $name
 * @property string $ascii_name
 * @property string $slug
 * @property Bundesland $bundesland
 * @property int $population
 */
#[Fillable(['id', 'name', 'ascii_name', 'slug', 'bundesland', 'population'])]
class DeCity extends Model
{
    /** @use HasFactory<DeCityFactory> */
    use HasFactory;

    protected $table = 'de_cities';

    public $incrementing = false;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'bundesland' => Bundesland::class,
            'population' => 'integer',
        ];
    }
}
