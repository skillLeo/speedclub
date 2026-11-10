<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M2.5 fix round. two_factor_locked_at: too many wrong second factors (10 an hour or 20 a day) lock new challenges and re-checks until a
 * password reset by e-mail code clears it. Browser sessions keep no IP from now on (ADR-113, NoIpDatabaseSessionHandler): the rows that
 * still hold one lose it here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('two_factor_locked_at')->nullable()->after('two_factor_last_step');
        });

        DB::table('sessions')->whereNotNull('ip_address')->update(['ip_address' => null]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('two_factor_locked_at');
        });
    }
};
