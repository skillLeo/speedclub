<?php

namespace App\Health\Checks;

use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;

class StorageLinkCheck extends Check
{
    public function run(): Result
    {
        return file_exists(public_path('storage'))
            ? Result::make('Linked')->ok()
            : Result::make()->failed('public/storage is missing, run php artisan storage:link.');
    }
}
