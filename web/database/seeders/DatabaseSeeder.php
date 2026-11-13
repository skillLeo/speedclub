<?php

namespace Database\Seeders;

use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Product;
use Database\Seeders\Concerns\SeedClock;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Everything except DemoSeeder is safe in production and safe to run again. ADR-234: the catalogue seeders (makes/models,
     * modification categories and fields, part brands, M4.14 products) only fill an empty table on install; on a host whose catalogue has rows they are
     * skipped, so a re-run never brings back an entry, a field or a brand the team deleted in the admin.
     */
    public function run(): void
    {
        $catalogue = array_keys(array_filter([
            CatalogSeeder::class => ! CatalogSeeder::catalogueHasRows(),
            ModCategorySeeder::class => ! ModCategory::query()->exists(),
            BrandSeeder::class => ! Brand::query()->exists(),
            // M4.14: the parts catalogue, after its brands and categories.
            ProductSeeder::class => ! Product::query()->exists(),
        ]));

        $seed = function () use ($catalogue): void {
            $this->call([
                ...$catalogue,
                LegalDocumentSeeder::class,
                HelpArticleSeeder::class,
                FeatureFlagSeeder::class,
                ConfigSeeder::class,
                StaffSeeder::class,
            ]);

            if (DemoSeeder::runsAutomatically()) {
                $this->call(DemoSeeder::class);
            }

            // After the demo, so a demo build can become a cover.
            $this->call(CollectionSeeder::class);
        };

        // DQ-677: on a demo host (local, staging with the demo) the install happens at the demo's clock, so ConfigSeeder v1, the roles,
        // flags and help articles carry the same timestamps after every re-seed. Production installs at the real time.
        if (DemoSeeder::runsAutomatically()) {
            SeedClock::at(DemoSeeder::clock(), $seed);
        } else {
            $seed();
        }
    }
}
