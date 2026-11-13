<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The staging showcase (DemoShowcaseSeeder, `speedclub:demo --purge`): sample members, their vehicles and the demo staff account carry
 * is_sample, so the purge finds exactly them and never touches a real account. Everything else of the showcase hangs off those rows
 * (cascades) or is found through them. media.sample_source names the seed file a sample photo was made from, so a re-run skips the
 * photos it already processed and replaces only what changed. Plain columns and indexes: MySQL 8 and MariaDB 10.6+.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_sample')->default(false)->index();
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->boolean('is_sample')->default(false)->index();
        });

        Schema::table('staff', function (Blueprint $table) {
            $table->boolean('is_sample')->default(false)->index();
        });

        Schema::table('media', function (Blueprint $table) {
            $table->string('sample_source', 160)->nullable();

            $table->index(['mediable_type', 'mediable_id', 'sample_source']);
        });
    }

    public function down(): void
    {
        Schema::table('media', function (Blueprint $table) {
            $table->dropIndex(['mediable_type', 'mediable_id', 'sample_source']);
            $table->dropColumn('sample_source');
        });

        foreach (['staff', 'vehicles', 'users'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->dropIndex(['is_sample']);
                $table->dropColumn('is_sample');
            });
        }
    }
};
