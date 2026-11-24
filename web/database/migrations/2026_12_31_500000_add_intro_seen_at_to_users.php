<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Client round 4 (R4-1.4, INTRO-01…04): when the account finished or skipped the short introduction after its first sign-in, so it
 * shows once per account and not again on another device. Existing accounts stay null: they see it once on their next sign-in.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('intro_seen_at')->nullable()->after('profile_setup_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('intro_seen_at');
        });
    }
};
