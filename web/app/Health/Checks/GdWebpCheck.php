<?php

namespace App\Health\Checks;

use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

class GdWebpCheck extends Check
{
    public function run(): Result
    {
        if (! function_exists('gd_info')) {
            return Result::make()->failed('The GD extension is not loaded.');
        }

        $info = gd_info();

        return $info['WebP Support'] && $info['FreeType Support']
            ? Result::make('WebP + FreeType')->ok()
            : Result::make()->failed('GD lacks WebP or FreeType support.');
    }
}
