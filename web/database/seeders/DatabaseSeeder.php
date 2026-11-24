<?php

namespace Database\Seeders;

use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Product;
use App\Services\Dex\DexNumbers;
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
                // M5.9b STREET DEX: the city list (reference geography, no coordinates) and the sets.
                DeCitySeeder::class,
                DexSetSeeder::class,
                // M5.9d: the launch badges (never changes a badge staff edited).
                BadgeSeeder::class,
                // M5.8: the forum's categories (one per make after the catalogue, one per Bundesland); never undoes an admin's edit.
                ForumCategorySeeder::class,
            ]);

            if (DemoSeeder::runsAutomatically()) {
                $this->call(DemoSeeder::class);
                // M5.5: badged shop samples (sticker drawings, a licensed hero photo), local and staging only.
                $this->call(ShopSampleSeeder::class);
                // M5.8: 25 badged forum sample threads by the showcase members, local and staging only.
                $this->call(ForumSampleSeeder::class);
                // R4-2.3: five badged sample crews of the showcase members, local and staging only.
                $this->call(ShowcaseCrewsSeeder::class);
            }

            // M5.9b: Dex numbers for published cars a seeder wrote without PublishVehicle, in the order of their first publish.
            app(DexNumbers::class)->assignMissing();

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
