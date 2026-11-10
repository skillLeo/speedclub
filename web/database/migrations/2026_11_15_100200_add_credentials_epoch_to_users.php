<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SEC-P2-02: a random value that changes whenever the member's sign-ins are ended or the address changes (CredentialEpoch). Signed
 * links that must not outlive such a change carry a keyed hash of it (the data export download). Null until the first change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('credentials_epoch', 32)->nullable()->after('remember_token');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('credentials_epoch');
        });
    }
};
