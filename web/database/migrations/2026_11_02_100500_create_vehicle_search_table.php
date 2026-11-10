<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicle_search', function (Blueprint $table) {
            $table->foreignUlid('vehicle_id')->primary()->constrained()->cascadeOnDelete();
            $table->foreignUlid('owner_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('make_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('model_id')->nullable()->constrained('vehicle_models')->nullOnDelete();
            $table->foreignId('generation_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedSmallInteger('model_year')->nullable()->index();
            $table->decimal('power_ps', 7, 2)->nullable()->index();
            $table->string('drivetrain', 20)->nullable()->index();
            $table->string('gearbox', 20)->nullable()->index();
            $table->string('fuel', 20)->nullable()->index();
            $table->decimal('wheel_diameter', 3, 1)->nullable()->index();
            $table->foreignId('wheel_brand_id')->nullable()->constrained('brands')->nullOnDelete();
            $table->string('suspension_type', 40)->nullable()->index();
            $table->foreignId('suspension_brand_id')->nullable()->constrained('brands')->nullOnDelete();
            $table->foreignId('exhaust_brand_id')->nullable()->constrained('brands')->nullOnDelete();
            $table->unsignedBigInteger('mod_category_mask')->default(0);
            $table->text('search_text')->nullable();
            $table->boolean('is_public')->default(false)->index();
            $table->timestamp('published_at')->nullable()->index();
            $table->timestamp('updated_at')->nullable()->index();
            $table->double('rank_score')->default(0)->index();

            $table->index(['make_id', 'model_id', 'generation_id']);
            $table->fullText('search_text');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_search');
    }
};
