<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.1 staff hardening.
 *
 * credentials_epoch (SEC-P1-25): a random value that changes with every password change or reset and every change of the second
 * factor. Each staff session keeps the value it signed in with; EnsureStaffActive ends a session whose value is stale. Null until the
 * first change.
 *
 * password_proof_required (SEC-P1-20): a seeded or invited account whose password nobody has proved by e-mail yet. Such an account
 * cannot sign in until its owner sets a password through the e-mailed reset link, so whoever knows a seeded password cannot enrol
 * their own authenticator first.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('staff', function (Blueprint $table) {
            $table->string('credentials_epoch', 32)->nullable()->after('remember_token');
            $table->boolean('password_proof_required')->default(false)->after('credentials_epoch');
        });
    }

    public function down(): void
    {
        Schema::table('staff', function (Blueprint $table) {
            $table->dropColumn(['credentials_epoch', 'password_proof_required']);
        });
    }
};
