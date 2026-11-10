<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * StaffSeeder's ledger (M3.6 follow-up): every pair of the spec table (role → atom) the seeder has handed out once. On an existing install
 * the seeder grants only pairs that are not in it yet (a new atom, a new spec row such as ADR-232), so a removal made in ADM-42 sticks
 * when the seeder runs again after a deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_seed_grants', function (Blueprint $table): void {
            $table->id();
            $table->string('role', 125);
            $table->string('permission', 125);
            $table->timestamp('created_at')->nullable();

            $table->unique(['role', 'permission']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('staff_seed_grants');
    }
};
