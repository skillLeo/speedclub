<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The step of the add-vehicle wizard a draft resumes at (F2); null once published.
        Schema::table('vehicles', function (Blueprint $table) {
            $table->unsignedTinyInteger('wizard_step')->nullable()->after('is_main');
        });

        // Until when an automatic update still takes further changes of the same vehicle (debounce, 02_PRODUCT_SPEC §3.2).
        Schema::table('build_updates', function (Blueprint $table) {
            $table->timestamp('open_until')->nullable()->after('hidden');

            $table->index(['vehicle_id', 'open_until']);
        });

        // Issued to someone who just proved the password, so a stranger's forgot requests cannot use up that budget (ADR-140).
        Schema::table('verification_codes', function (Blueprint $table) {
            $table->boolean('proved')->default(false)->after('attempts');
        });
    }

    public function down(): void
    {
        Schema::table('verification_codes', function (Blueprint $table) {
            $table->dropColumn('proved');
        });

        Schema::table('build_updates', function (Blueprint $table) {
            $table->dropIndex(['vehicle_id', 'open_until']);
            $table->dropColumn('open_until');
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn('wizard_step');
        });
    }
};
