<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * SEC-M46-02: when a sign-in passed the second factor (a token; a browser keeps it in its session), and when a linked provider was
     * last tied to a passed second factor. A provider without one asks for the code at its first sign-in on an account with two-factor on.
     */
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->timestamp('second_factor_at')->nullable()->after('reauthenticated_at');
        });

        Schema::table('social_accounts', function (Blueprint $table) {
            $table->timestamp('second_factor_at')->nullable()->after('last_used_at');
        });
    }

    public function down(): void
    {
        Schema::table('social_accounts', function (Blueprint $table) {
            $table->dropColumn('second_factor_at');
        });

        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropColumn('second_factor_at');
        });
    }
};
