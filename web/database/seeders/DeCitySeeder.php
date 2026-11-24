<?php

namespace Database\Seeders;

use App\Enums\Bundesland;
use App\Support\Slug;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * M5.9b STREET DEX (m5.9b contract §1): de_cities from database/data/de_cities.csv (GeoNames cities1000 of Germany, CC BY 4.0, see
 * database/data/CREDITS.md; built by build-de-cities.py together with public/geo/de-cities.json). The CSV holds no coordinates. Safe in
 * production and safe to run again: rows are upserted by their GeoNames id; a city that left the list stays (spots may point at it).
 */
class DeCitySeeder extends Seeder
{
    use SeedsFromData;

    private const CHUNK = 500;

    public function run(): void
    {
        $path = database_path('data/de_cities.csv');
        $handle = fopen($path, 'r');

        if ($handle === false) {
            throw new RuntimeException("Cannot read $path.");
        }

        $header = fgetcsv($handle, escape: '');

        if ($header !== ['id', 'name', 'ascii_name', 'bundesland', 'population']) {
            throw new RuntimeException("Unexpected header in $path.");
        }

        $rows = [];
        $count = 0;

        while (($line = fgetcsv($handle, escape: '')) !== false) {
            if (count($line) !== 5 || Bundesland::tryFrom((string) $line[3]) === null) {
                continue;
            }

            $rows[] = [
                'id' => (int) $line[0],
                'name' => (string) $line[1],
                'ascii_name' => (string) $line[2],
                'slug' => Slug::make((string) $line[1]),
                'bundesland' => (string) $line[3],
                'population' => (int) $line[4],
            ];

            if (count($rows) === self::CHUNK) {
                $count += $this->write($rows);
                $rows = [];
            }
        }

        fclose($handle);
        $count += $this->write($rows);

        $this->say("German cities: {$count} rows.");
    }

    /**
     * @param  list<array<string, int|string>>  $rows
     */
    private function write(array $rows): int
    {
        if ($rows !== []) {
            DB::table('de_cities')->upsert($rows, ['id'], ['name', 'ascii_name', 'slug', 'bundesland', 'population']);
        }

        return count($rows);
    }
}
