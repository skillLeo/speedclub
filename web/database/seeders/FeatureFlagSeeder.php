<?php

namespace Database\Seeders;

use App\Models\FeatureFlag;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;

/**
 * 02_PRODUCT_SPEC §5 and §6: sig.* is on outside production and off in production, ai.* is off everywhere.
 * Existing flags keep their state, so running this again never undoes a change in the admin.
 */
class FeatureFlagSeeder extends Seeder
{
    use SeedsFromData;

    /**
     * Signature flags that stay off in every environment until their feature is built. Turning one on would show half a
     * feature on one surface only.
     *
     * @var array<string, string> key => why
     */
    public const OFF_UNTIL_BUILT = [
        // Empty since M2.7 built the legal status of mods (ADR-153 lifted; data update 2026_11_13_170100).
    ];

    /**
     * @return array<string, string>
     */
    private function offUntilBuilt(): array
    {
        return self::OFF_UNTIL_BUILT;
    }

    public function run(): void
    {
        /** @var array<string, string> $flags */
        $flags = $this->readJson('feature_flags.json');
        $production = app()->environment('production');

        foreach ($flags as $key => $description) {
            FeatureFlag::query()->firstOrCreate(['key' => $key], [
                'enabled' => str_starts_with($key, 'sig.') && ! $production && ! array_key_exists($key, $this->offUntilBuilt()),
                'description' => $description,
            ]);
        }
    }
}
