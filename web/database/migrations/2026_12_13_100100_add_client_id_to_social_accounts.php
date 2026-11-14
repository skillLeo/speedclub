<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * SEC-P4-03 (Low): the client the provider issued the link's tokens to (the ID token's `aud`: for Apple the bundle ID of the app or the
     * Services ID of the web). Apple revokes a refresh token only with the client_id it was issued to, so AppleTokens::revoke uses this
     * one; links stored before have none and fall back to the first configured client, as before.
     */
    public function up(): void
    {
        Schema::table('social_accounts', function (Blueprint $table): void {
            $table->string('client_id', 255)->nullable()->after('provider_sub');
        });
    }

    public function down(): void
    {
        Schema::table('social_accounts', function (Blueprint $table): void {
            $table->dropColumn('client_id');
        });
    }
};
