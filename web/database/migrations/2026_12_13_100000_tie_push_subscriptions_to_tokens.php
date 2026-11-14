<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * SEC-P4-01 (Medium, ADR-461 d): a Web Push subscription registered with an app token (no member web session) had no tie to that
     * sign-in and outlived its end in SET-06 by up to orphan_days. token_id is the token that registered it; the foreign key deletes the
     * subscription with the token on every path that ends one (SET-06 "Abmelden", sign-out, "Alle anderen abmelden", sanctum:prune-expired),
     * and WebPushSessions treats a row whose token expired as ended. A rotation moves the tie to the new token (RotateMemberToken).
     * Subscriptions registered before this have no tie and keep the orphan_days rule.
     */
    public function up(): void
    {
        Schema::table('push_subscriptions', function (Blueprint $table): void {
            $table->foreignId('token_id')->nullable()->after('session_key')->constrained('personal_access_tokens')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('push_subscriptions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('token_id');
        });
    }
};
