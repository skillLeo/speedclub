<?php

namespace App\Services\Garage;

use App\Models\ModCategory;
use Illuminate\Database\Eloquent\Collection;

/**
 * The category schemas, read once per request: a Verlauf page renders many entries against the same few rows. A key it does
 * not know yet makes it read again, so a category added meanwhile is found.
 */
class ModCatalog
{
    private const REQUEST_ATTRIBUTE = 'speedclub.mod-categories';

    public function find(string $key): ?ModCategory
    {
        return $this->categories()->get($key) ?? $this->categories(fresh: true)->get($key);
    }

    /**
     * @return Collection<string, ModCategory>
     */
    private function categories(bool $fresh = false): Collection
    {
        $attributes = request()->attributes;

        /** @var Collection<string, ModCategory>|null $categories */
        $categories = $attributes->get(self::REQUEST_ATTRIBUTE);

        if ($categories === null || $fresh) {
            $categories = ModCategory::query()->with('fields')->get()->keyBy('key');
            $attributes->set(self::REQUEST_ATTRIBUTE, $categories);
        }

        return $categories;
    }
}
