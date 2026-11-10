<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.4: the explanation the staff member who decided an appeal wrote for the appellant (Art. 20(4) DSA). The outcome mail reads it at run
 * time, so its queued job carries the appeal id only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('appeals', function (Blueprint $table): void {
            $table->text('outcome_explanation')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('appeals', function (Blueprint $table): void {
            $table->dropColumn('outcome_explanation');
        });
    }
};
