<?php

namespace Database\Seeders;

use App\Models\Brand;
use App\Support\Slug;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;

/**
 * Part brands by main category. A brand active in several categories keeps one hint; its other names are aliases.
 * Adds what is missing and leaves existing rows alone, so running it again never undoes a merge in the admin.
 */
class BrandSeeder extends Seeder
{
    use SeedsFromData;

    public function run(): void
    {
        /** @var array<string, list<array{0: string, 1: list<string>}>> $categories */
        $categories = $this->readJson('brands.json');
        $existing = Brand::query()->pluck('slug')->all();
        $now = now();
        $rows = [];

        foreach ($categories as $hint => $brands) {
            foreach ($brands as [$name, $aliases]) {
                $slug = Slug::make($name);

                if (! in_array($slug, $existing, true)) {
                    $rows[] = [
                        'slug' => $slug,
                        'name' => $name,
                        'category_hint' => $hint,
                        'aliases' => $aliases === [] ? null : json_encode($aliases, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
            }
        }

        Brand::query()->insert($rows);
    }
}
