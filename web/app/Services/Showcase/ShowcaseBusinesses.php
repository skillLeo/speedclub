<?php

namespace App\Services\Showcase;

use App\Enums\BusinessKind;
use App\Enums\BusinessLegalForm;
use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModTagInitiator;
use App\Enums\ModTagStatus;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\Media;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use App\Support\Slug;
use Illuminate\Support\Facades\DB;

/**
 * The sample business of the showcase (09 §8.19, ADR-412, M4.14) from database/data/showcase/businesses.json: an obviously fictional
 * workshop owned by the SPEED CLUB Editorial account, verified, is_sample, with placeholder Impressum data the page marks as such and a
 * graded seed photo as cover. Its portfolio: Editorial builds whose suspension part is linked to the catalogue (both sides are the
 * Editorial account, so the tag is confirmed). It also links the mods of sample builds to catalogue products by brand and part name
 * (only exact slug matches; nothing is guessed). Local and staging only; ShowcasePurge removes it with the Editorial account.
 */
class ShowcaseBusinesses
{
    private const COVER_SOURCE = 'business-cover:';

    /**
     * @return int businesses written
     */
    public function seed(?string $photos = null): int
    {
        Showcase::assertEnvironment('ShowcaseBusinesses');
        $photos ??= base_path('../design/seed-photos');
        $owner = User::query()->where('username', ShowcaseEvents::EDITORIAL)->where('is_sample', true)->first();

        if (! $owner instanceof User) {
            return 0;
        }

        $this->linkProducts();
        $data = json_decode((string) file_get_contents(database_path('data/showcase/businesses.json')), true);
        $written = 0;

        foreach (is_array($data) && is_array($data['businesses'] ?? null) ? $data['businesses'] : [] as $row) {
            if (! is_array($row) || BusinessMember::query()->where('user_id', $owner->id)->whereHas('business', fn ($query) => $query->where('slug', '!=', $row['slug']))->exists()) {
                continue;
            }

            $business = $this->business($owner, $row);
            $this->cover($business, $owner, is_string($row['cover'] ?? null) ? $row['cover'] : null, $photos);
            $this->portfolio($business, $owner, (int) ($row['portfolio'] ?? 0));
            $written++;
        }

        return $written;
    }

    /**
     * Sample mods name real products by brand and part ("KW" + "Variante 3"): link the catalogue product where the slugs match exactly.
     */
    public function linkProducts(): int
    {
        $linked = 0;
        $mods = Modification::query()->whereNull('product_id')->whereNotNull('brand_id')->whereNotNull('part_name')
            ->whereIn('vehicle_id', Vehicle::query()->where('is_sample', true)->select('id'))->get();

        foreach ($mods as $mod) {
            $product = Product::query()->active()->where('brand_id', $mod->getAttribute('brand_id'))->where('slug', Slug::make((string) $mod->getAttribute('part_name')))->first();

            if ($product instanceof Product) {
                $mod->forceFill(['product_id' => $product->id])->saveQuietly();
                $linked++;
            }
        }

        return $linked;
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function business(User $owner, array $row): Business
    {
        return DB::transaction(function () use ($owner, $row): Business {
            $business = Business::query()->where('slug', (string) $row['slug'])->first() ?? (new Business)->forceFill(['slug' => (string) $row['slug']]);
            $business->fill(array_intersect_key($row, array_flip(['name', 'legal_name', 'representative', 'street', 'postcode', 'city', 'lat', 'lng', 'email', 'register_court', 'register_number', 'about', 'services', 'opening_hours'])));
            $business->forceFill([
                'owner_id' => $owner->id,
                'kind' => BusinessKind::from((string) $row['kind']),
                'legal_form' => BusinessLegalForm::from((string) $row['legal_form']),
                'country' => 'DE',
                'status' => BusinessStatus::Verified,
                'is_sample' => true,
                'submitted_at' => $business->submitted_at ?? now()->subDays(30),
                'verified_at' => $business->verified_at ?? now()->subDays(29),
            ])->save();

            BusinessMember::query()->firstOrCreate(['business_id' => $business->id, 'user_id' => $owner->id], ['role' => BusinessRole::Owner]);

            return $business;
        });
    }

    private function portfolio(Business $business, User $owner, int $count): void
    {
        if ($count <= 0) {
            return;
        }

        $mods = Modification::query()
            ->whereNotNull('product_id')
            ->whereHas('category', fn ($category) => $category->where('key', 'suspension'))
            ->whereIn('vehicle_id', Vehicle::query()->where('owner_id', $owner->id)->where('is_sample', true)->orderBy('created_at')->orderBy('id')->select('id'))
            ->orderBy('vehicle_id')->orderBy('id')
            ->get()->unique('vehicle_id')->take($count);

        foreach ($mods as $mod) {
            $tag = ModBusinessTag::query()->where('mod_id', $mod->id)->first() ?? new ModBusinessTag;
            $tag->forceFill([
                'mod_id' => $mod->id,
                'business_id' => $business->id,
                'status' => ModTagStatus::Accepted,
                'initiated_by' => ModTagInitiator::Member,
                'requested_by' => $owner->id,
                'decided_by' => $owner->id,
                'decided_at' => $tag->decided_at ?? now(),
            ])->save();
            $mod->forceFill(['installed_by_business_id' => $business->id])->saveQuietly();
        }
    }

    /**
     * The graded seed photo only (processed/<name>-2048.jpg), imported once (sample_source), approved, with the manifest's alt text.
     */
    private function cover(Business $business, User $owner, ?string $file, string $photos): void
    {
        if ($file === null) {
            return;
        }

        $source = self::COVER_SOURCE.$file;
        $current = $business->getAttribute('cover_media_id');
        $media = is_string($current) ? Media::query()->find($current) : null;

        if ($media instanceof Media && $media->getAttribute('sample_source') === $source) {
            return;
        }

        $path = ShowcasePhotos::gradedPath($photos, $file);

        if ($path === null) {
            return;
        }

        $alt = null;
        $manifest = json_decode((string) @file_get_contents(rtrim($photos, '/').'/manifest.json'), true);

        foreach (is_array($manifest) ? $manifest : [] as $entry) {
            if (is_array($entry) && ($entry['file'] ?? null) === $file) {
                $alt = is_string($entry['alt_de'] ?? null) ? $entry['alt_de'] : null;
                $thumbhash = is_string($entry['thumbhash'] ?? null) ? $entry['thumbhash'] : null;
            }
        }

        $service = app(MediaService::class);
        $imported = $service->storeFromPath($path, $owner, $business, ['alt' => $alt]);
        $imported->forceFill(['sample_source' => $source, 'moderation_status' => ModerationStatus::Approved, 'thumbhash' => $thumbhash ?? null])->save();
        $business->forceFill(['cover_media_id' => $imported->id])->save();

        if ($media instanceof Media) {
            $service->purge($media);
        }
    }

    /**
     * Sample businesses with their photos, for ShowcasePurge (the rest cascades).
     */
    public function purge(): int
    {
        $count = 0;

        foreach (Business::query()->where('is_sample', true)->get() as $business) {
            foreach (Media::withTrashed()->where('mediable_type', $business->getMorphClass())->where('mediable_id', $business->id)->get() as $media) {
                app(MediaService::class)->purge($media);
            }

            Modification::withTrashed()->where('installed_by_business_id', $business->id)->update(['installed_by_business_id' => null]);
            $business->delete();
            $count++;
        }

        return $count;
    }
}
