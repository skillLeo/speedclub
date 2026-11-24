<?php

namespace Database\Seeders;

use App\Models\DexSet;
use App\Services\Dex\DexSets;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;

/**
 * M5.9b STREET DEX (m5.9b contract §1): the JDM, city and season sets from config/speedclub.php `dex.sets` (brand sets come per make at
 * its first spot, DexSets::brandSet). Safe in production and safe to run again: an existing set is never changed, so an edit made later
 * (hidden, a rule) survives.
 */
class DexSetSeeder extends Seeder
{
    use SeedsFromData;

    public function run(): void
    {
        $created = 0;

        foreach (DexSets::definitions() as $definition) {
            $set = DexSet::query()->firstOrCreate(['key' => $definition['key']], $definition);
            $created += $set->wasRecentlyCreated ? 1 : 0;
        }

        $this->say("Dex sets: {$created} new.");
    }
}
