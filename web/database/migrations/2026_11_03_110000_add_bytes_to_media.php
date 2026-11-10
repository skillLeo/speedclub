<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * What a photo takes on the disks, for the allowance per member (ADR-146). Two columns, since deleting a photo frees the public
     * files and leaves the private original until the hard delete. The sum is read per member: owner_id already has its index.
     */
    public function up(): void
    {
        Schema::table('media', function (Blueprint $table) {
            $table->unsignedInteger('original_bytes')->default(0)->after('height');
            $table->unsignedInteger('variant_bytes')->default(0)->after('original_bytes');
        });
    }

    public function down(): void
    {
        Schema::table('media', function (Blueprint $table) {
            $table->dropColumn(['original_bytes', 'variant_bytes']);
        });
    }
};
