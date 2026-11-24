<?php

namespace App\Console\Commands;

use App\Services\CarOfTheDay\CarOfTheDayRunner;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('car-of-the-day:run')]
#[Description('Picks the Car of the Day from 17:55 and publishes it at 18:00 Europe/Berlin, owner and opt-in notifications (m5.9d §3)')]
class CarOfTheDayCommand extends Command
{
    public function handle(CarOfTheDayRunner $runner): int
    {
        $result = $runner->run();

        if ($result === null) {
            $this->info('Another car-of-the-day:run is still working.');

            return self::SUCCESS;
        }

        $this->info(sprintf('%s: picked %s, published %s, told %s.', $result['day'], $result['picked'] ? 'yes' : 'no', $result['published'] ? 'yes' : 'no', $result['told'] ? 'yes' : 'no'));

        return self::SUCCESS;
    }
}
