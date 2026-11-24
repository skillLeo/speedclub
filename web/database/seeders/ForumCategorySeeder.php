<?php

namespace Database\Seeders;

use App\Services\Forum\ForumCategorySync;
use Illuminate\Database\Seeder;

/**
 * M5.8 (10 §7.1): the forum's categories in every environment, after the catalogue (one sub-category per make). Idempotent by slug:
 * running it again adds what is missing and never undoes an admin's edit.
 */
class ForumCategorySeeder extends Seeder
{
    public function run(ForumCategorySync $sync): void
    {
        $sync->run();
    }
}
