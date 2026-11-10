<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An accent-insensitive collation made máx@example.de the same account as max@example.de, although they are different
     * mailboxes (ADR-136). Lookups and the unique index now compare bytes. Addresses are stored lowercase, so case still
     * does not matter: the requests and the model normalise before anything reaches this column.
     */
    public function up(): void
    {
        DB::table('users')->update(['email' => DB::raw('LOWER(email)')]);

        Schema::table('users', function (Blueprint $table) {
            $table->string('email')->collation('utf8mb4_bin')->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('email')->collation('utf8mb4_unicode_ci')->change();
        });
    }
};
