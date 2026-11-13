<?php

namespace App\Models;

use App\Enums\ProductStatus;
use Database\Factories\ProductFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A product of the parts catalogue (09 §8.9, BRD-02): a real product of a part brand, in a mod category. Staff manage it (ADM-57, the
 * import command and CSV); members read it and link it on their mods. `attributes` are per language: {"de": {label: value}, "en": …}.
 * A merged product points at its survivor (merged_into_id), whose mods it handed over.
 *
 * @property string $id
 * @property int $brand_id
 * @property int $category_id
 * @property string $name
 * @property string|null $line
 * @property string $slug
 * @property string|null $url
 * @property string|null $affiliate_url
 * @property ProductStatus $status
 * @property list<string>|null $aliases
 * @property string|null $merged_into_id
 * @property-read Brand $brand
 * @property-read ModCategory $category
 */
class Product extends Model
{
    /** @use HasFactory<ProductFactory> */
    use HasFactory, HasUlids;

    /**
     * "In 14 Builds": the real number of visible builds with this product, set by ProductPresenter for a page (never stored).
     */
    public ?int $buildCount = null;

    /** @var list<string> */
    protected $fillable = ['brand_id', 'category_id', 'name', 'line', 'slug', 'attributes', 'url', 'affiliate_url', 'aliases'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'attributes' => 'array',
            'aliases' => 'array',
            'status' => ProductStatus::class,
        ];
    }

    /**
     * The column "attributes" shares its name with Eloquent's row array, so code reads it through getAttribute() and this helper only.
     * Stored as ordered pairs per language (ProductCatalogue::attributes).
     *
     * @return array<string, string> label => value in $locale (German when that language has none), in the catalogue's order
     */
    public function attributeTable(string $locale): array
    {
        $decoded = $this->getAttribute('attributes');

        if (! is_array($decoded)) {
            return [];
        }

        $rows = $decoded[$locale] ?? $decoded['de'] ?? [];
        $table = [];

        foreach (is_array($rows) ? $rows : [] as $key => $row) {
            [$label, $value] = is_array($row) && count($row) === 2 ? array_values($row) : [$key, $row];

            if (is_string($label) && is_string($value)) {
                $table[$label] = $value;
            }
        }

        return $table;
    }

    /**
     * Brand name and product, "KW Variante 3".
     */
    public function fullName(): string
    {
        $brand = $this->brand->name;

        return str_starts_with(mb_strtolower($this->name), mb_strtolower($brand)) ? $this->name : $brand.' '.$this->name;
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('products.status', ProductStatus::Active->value)->whereNull('products.merged_into_id');
    }

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /**
     * @return BelongsTo<ModCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ModCategory::class, 'category_id');
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function mergedInto(): BelongsTo
    {
        return $this->belongsTo(self::class, 'merged_into_id');
    }

    /**
     * @return HasMany<Modification, $this>
     */
    public function modifications(): HasMany
    {
        return $this->hasMany(Modification::class);
    }
}
