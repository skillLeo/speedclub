<?php

namespace App\Services\Dex;

use App\Models\Spot;

/**
 * What POST spots answers (m5.9b contract §2): the spot, whether it was new or the same car again within 24 h (duplicate, 200), and
 * what it changed. reason is "account_too_new" when the account is younger than 24 h, "sample_car" when a real member scanned a sample
 * car (CR-P5G-07); either way the spot is stored but not counted.
 */
final readonly class SpotOutcome
{
    /**
     * @param  list<array{key: string, name: string, progress: int, target: int, completed: bool}>  $setProgress
     * @param  'account_too_new'|'sample_car'|null  $reason
     */
    public function __construct(
        public Spot $spot,
        public bool $newInDex,
        public bool $duplicate,
        public bool $firstSpotter,
        public array $setProgress,
        /** @var 'account_too_new'|'sample_car'|null */
        public ?string $reason = null,
    ) {}
}
