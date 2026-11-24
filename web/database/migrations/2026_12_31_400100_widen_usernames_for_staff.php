<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Client round 2 (2026-11-19): staff may give a member a username up to speedclub.usernames.staff_max_length (40) in ADM-10;
 * members keep choosing 5 to 24 characters. The old name column follows, as a staff change keeps it as previous_username.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('username', 40)->nullable()->change();
            $table->string('previous_username', 40)->nullable()->change();
        });
    }

    public function down(): void
    {
        // Narrowing could cut a staff-given name; the wider columns stay.
    }
};
