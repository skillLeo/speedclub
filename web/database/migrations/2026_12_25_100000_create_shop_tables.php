<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * M5.5 Shop (10 §3, m5.5-contract §1): the admin-managed catalogue (ADM-66), its 4:5 photos and the SHOP-01 hero banners (ADM-67).
     * Prices are gross cents incl. MwSt. (PAngV); payment happens on Shopify only (ADR-502). Runs on MySQL 8 and MariaDB 10.6.
     */
    public function up(): void
    {
        Schema::create('shop_products', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('slug', 140)->unique();
            $table->string('title', 120);
            $table->text('description')->nullable();
            $table->string('category', 20)->index();
            $table->unsignedInteger('price_cents');
            $table->char('currency', 3)->default('EUR');
            $table->string('variant_kind', 20)->default('size');
            $table->json('variants')->nullable();
            $table->string('purchase_mode', 20)->default('shopify');
            $table->string('shopify_url', 500)->nullable();
            $table->unsignedInteger('sort')->default(0)->index();
            $table->boolean('visible')->default(false);
            $table->boolean('is_sample')->default(false)->index();
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes()->index();

            $table->index(['visible', 'category', 'sort'], 'shop_products_listing_index');
        });

        Schema::create('shop_product_images', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('shop_product_id')->constrained('shop_products')->cascadeOnDelete();
            $table->unsignedSmallInteger('sort')->default(0);
            $this->imageColumns($table);
            $table->foreignId('uploaded_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();

            $table->index(['shop_product_id', 'sort']);
        });

        Schema::create('shop_banners', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('title', 80);
            $table->string('subtitle', 140)->nullable();
            $table->string('link_kind', 20);
            $table->foreignUlid('shop_product_id')->nullable()->constrained('shop_products')->nullOnDelete();
            $table->string('category', 20)->nullable();
            $this->imageColumns($table);
            $table->boolean('active')->default(false)->index();
            $table->boolean('is_sample')->default(false)->index();
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_banners');
        Schema::dropIfExists('shop_product_images');
        Schema::dropIfExists('shop_products');
    }

    /**
     * The re-encoded photo (App\Services\Shop\ShopImages): private clean original, public WebP variants, placeholder hashes.
     */
    private function imageColumns(Blueprint $table): void
    {
        $table->string('alt', 200)->nullable();
        $table->unsignedInteger('width');
        $table->unsignedInteger('height');
        $table->unsignedInteger('original_width');
        $table->unsignedInteger('original_height');
        $table->decimal('focal_x', 4, 3)->default(0.5);
        $table->decimal('focal_y', 4, 3)->default(0.5);
        $table->string('blurhash', 64);
        $table->string('thumbhash', 64)->nullable();
        $table->string('original_path', 255);
        $table->json('variants');
        $table->char('sha256', 64);
        $table->unsignedInteger('bytes');
    }
};
