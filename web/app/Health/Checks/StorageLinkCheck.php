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
            // ADR-539: the /storage route serves the public disk through PHP meanwhile; slower, not broken.
            : Result::make('Served through PHP')->warning('public/storage is not a link: photos are served through PHP (slower). Run php artisan storage:link where the host allows it.');
    }
}
