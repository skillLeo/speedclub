<?php

namespace App\Http\Csp;

use Spatie\Csp\Directive;
use Spatie\Csp\Keyword;
use Spatie\Csp\Policy;
use Spatie\Csp\Preset;

/**
 * JSON never needs to load anything.
 */
class ApiPreset implements Preset
{
    public function configure(Policy $policy): void
    {
        $policy
            ->add(Directive::DEFAULT, Keyword::NONE)
            ->add(Directive::FRAME_ANCESTORS, Keyword::NONE);
    }
}
