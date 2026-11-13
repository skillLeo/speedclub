<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Enums\LegalStatus;
use App\Enums\ModStatus;
use App\Exceptions\ApiException;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Product;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\BuildUpdates;
use App\Services\Garage\ModFields;
use App\Services\Rules\ContentScreen;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Garage\SavedModification;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Create and edit of GAR-10 (02_PRODUCT_SPEC §3.3). The category's schema decides the fields. Brand and part fall back to what
 * the category form holds in its fields, so a client need not send them twice, and the title is brand + model until the member
 * writes their own. Costs stay private, always (M4.9 ruling, cost_public is ignored); legal_status exists only while its flag is on. An edit of
 * nothing but what only the owner reads (notes, a private cost) leaves the vehicle's updated_at alone.
 */
class SaveModification
{
    /** Fields that name the same thing as the common part column. */
    private const PART_FIELDS = ['model', 'wheel_model'];

    public function __construct(
        private readonly ModFields $fields,
        private readonly FeatureFlags $flags,
        private readonly BuildUpdates $updates,
        private readonly VehicleSearchProjector $search,
        private readonly ContentScreen $screen,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function add(Vehicle $vehicle, ModCategory $category, array $attributes): Modification
    {
        $flags = $this->screen->screen(self::screened($attributes));

        return DB::transaction(function () use ($vehicle, $category, $attributes, $flags): Modification {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $limit = config()->integer('speedclub.garage.max_modifications_per_vehicle');

            if ($vehicle->modifications()->count() >= $limit) {
                $reason = (string) __('garage.mod_limit_reached', ['max' => $limit]);

                throw new ApiException(ErrorCode::ValidationFailed, $reason, errors: ['modification' => [$reason]]);
            }

            $sort = $vehicle->modifications()->withTrashed()->max('sort');

            $mod = new Modification;
            $mod->forceFill(['vehicle_id' => $vehicle->id, 'category_id' => $category->id, 'sort' => is_numeric($sort) ? (int) $sort + 1 : 1]);
            $mod->setRelation('category', $category);
            $mod->setRelation('vehicle', $vehicle);

            $this->fill($mod, $category, $attributes, isNew: true);
            $mod->save();

            $this->updates->modAdded($mod);
            $this->search->changed($vehicle);
            // A flagged title files its report about the build it is shown on.
            $this->screen->flagAfterCommit($flags, $vehicle);

            return $mod;
        });
    }

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function change(Modification $mod, array $attributes): SavedModification
    {
        $flags = $this->screen->screen(self::screened($attributes));

        return DB::transaction(function () use ($mod, $attributes, $flags): SavedModification {
            $vehicle = $mod->vehicle;
            $this->screen->flagAfterCommit($flags, $vehicle);
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            // What the route read may be older than the lock: compare against what is stored now, and a delete in between wins.
            $mod->refresh();

            if ($mod->trashed()) {
                throw new ApiException(ErrorCode::NotFound);
            }

            $before = $this->updates->snapshot($mod);
            $publicBefore = $this->publicFace($mod);

            $this->fill($mod, $mod->category, $attributes, isNew: false);
            $mod->save();

            $recorded = $mod->wasChanged() && $this->updates->modChanged($mod, $before);

            // Touching the vehicle moves it in "Neue Builds" and its public updated_at: only for what others can read (SEC-M18-03).
            if ($this->publicFace($mod) !== $publicBefore) {
                $this->search->changed($vehicle);
            }

            return new SavedModification($mod, $recorded);
        });
    }

    /**
     * What anybody but the owner can read of a modification (ModificationResource, the search keys, the public page): everything
     * but the notes and the cost. As JSON with sorted fields, so a form that sends the same values in
     * another order changes nothing.
     */
    private function publicFace(Modification $mod): string
    {
        /** @var array<string, mixed> $fields */
        $fields = $mod->getAttribute('fields') ?? [];
        ksort($fields);
        $installed = $mod->getAttribute('installed_on');

        return (string) json_encode([
            'title' => $mod->getAttribute('title'),
            'status' => $mod->getAttribute('status') instanceof ModStatus ? $mod->getAttribute('status')->value : $mod->getAttribute('status'),
            'fields' => $fields,
            'brand_id' => $mod->getAttribute('brand_id'),
            'brand_text' => $mod->getAttribute('brand_text'),
            'part_name' => $mod->getAttribute('part_name'),
            'part_number' => $mod->getAttribute('part_number'),
            'product_id' => $mod->getAttribute('product_id'),
            'installed_on' => $installed instanceof CarbonInterface ? $installed->format('Y-m') : null,
            'legal_status' => $mod->getAttribute('legal_status') instanceof LegalStatus ? $mod->getAttribute('legal_status')->value : $mod->getAttribute('legal_status'),
            'sort' => $mod->getAttribute('sort'),
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function fill(Modification $mod, ModCategory $category, array $attributes, bool $isNew): void
    {
        $autoTitle = $isNew ? null : $this->autoTitle($mod);
        $fieldsSent = array_key_exists('fields', $attributes);

        /** @var array<string, mixed> $current */
        $current = $mod->getAttribute('fields') ?? [];
        /** @var array<array-key, mixed> $incoming */
        $incoming = $fieldsSent && is_array($attributes['fields']) ? $attributes['fields'] : $current;

        // The category "other" has nothing but a title, and its form field is the common one.
        $titleIsField = $category->key === 'other' && is_string($attributes['title'] ?? null);

        if ($titleIsField) {
            $incoming['title'] = $attributes['title'];
        }

        /** @var array<string, mixed> $fields */
        $fields = $isNew || $fieldsSent || $titleIsField ? $this->fields->validated($category, $incoming) : $current;

        $mod->setAttribute('fields', $fields);

        if ($isNew || $fieldsSent || array_key_exists('brand_id', $attributes) || array_key_exists('brand_text', $attributes)) {
            $this->fillBrand($mod, $fields, $current, $attributes);
        }

        if ($isNew || $fieldsSent || array_key_exists('part_name', $attributes)) {
            $this->fillPart($mod, $fields, $current, $attributes);
        }

        $this->fillProduct($mod, $attributes);

        foreach (['part_number', 'notes', 'cost_cents'] as $key) {
            if (array_key_exists($key, $attributes)) {
                $mod->setAttribute($key, $attributes[$key]);
            }
        }

        // M4.9 ruling (09 §11): costs are never public; a cost_public an older app still sends changes nothing.
        $mod->setAttribute('cost_public', false);

        if (array_key_exists('status', $attributes)) {
            $mod->setAttribute('status', $attributes['status']);
        } elseif ($isNew) {
            $mod->setAttribute('status', ModStatus::Installed);
        }

        $this->fillInstalled($mod, $attributes);
        $this->fillLegalStatus($mod, $attributes, $isNew);

        // A title the member wrote stays; one the server derived follows brand and model.
        $title = $attributes['title'] ?? null;

        if (is_string($title)) {
            $mod->setAttribute('title', $title);
        } elseif ($isNew || array_key_exists('title', $attributes) || $mod->getAttribute('title') === $autoTitle) {
            $mod->setAttribute('title', $this->autoTitle($mod));
        }
    }

    /**
     * A brand that came from the fields leaves with them. One set directly through brand_id or brand_text stays when the fields
     * never named it.
     *
     * @param  array<string, mixed>  $fields
     * @param  array<string, mixed>  $previous  the fields before this edit
     * @param  array<string, mixed>  $attributes
     */
    private function fillBrand(Modification $mod, array $fields, array $previous, array $attributes): void
    {
        if (array_key_exists('brand_id', $attributes) || array_key_exists('brand_text', $attributes)) {
            $id = $attributes['brand_id'] ?? null;

            if ($id !== null) {
                $id = Brand::query()->whereKey($id)->value('merged_into_id') ?? $id;
            }

            $mod->setAttribute('brand_id', $id);
            $mod->setAttribute('brand_text', $id === null ? ($attributes['brand_text'] ?? null) : null);

            return;
        }

        foreach (ModFields::BRAND_FIELDS as $key) {
            if (is_string($fields[$key] ?? null)) {
                $brand = Brand::query()->where('name', $fields[$key])->first();
                $mod->setAttribute('brand_id', $brand === null ? null : ($brand->getAttribute('merged_into_id') ?? $brand->getKey()));
                $mod->setAttribute('brand_text', $brand === null ? $fields[$key] : null);

                return;
            }
        }

        if ($this->namedAny($previous, ModFields::BRAND_FIELDS)) {
            $mod->setAttribute('brand_id', null);
            $mod->setAttribute('brand_text', null);
        }
    }

    /**
     * As with the brand.
     *
     * @param  array<string, mixed>  $fields
     * @param  array<string, mixed>  $previous  the fields before this edit
     * @param  array<string, mixed>  $attributes
     */
    private function fillPart(Modification $mod, array $fields, array $previous, array $attributes): void
    {
        if (array_key_exists('part_name', $attributes)) {
            $mod->setAttribute('part_name', $attributes['part_name']);

            return;
        }

        foreach (self::PART_FIELDS as $key) {
            if (is_string($fields[$key] ?? null)) {
                $mod->setAttribute('part_name', $fields[$key]);

                return;
            }
        }

        if ($this->namedAny($previous, self::PART_FIELDS)) {
            $mod->setAttribute('part_name', null);
        }
    }

    /**
     * M4.14 (09 §8.9): a linked catalogue product names the brand (its catalogue brand) and, unless the member wrote one, the part.
     * Unlinking keeps brand and part as they are. Ignored while parts_catalogue is off.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function fillProduct(Modification $mod, array $attributes): void
    {
        if (! array_key_exists('product_id', $attributes) || ! $this->flags->enabled('parts_catalogue')) {
            return;
        }

        $id = $attributes['product_id'];
        $product = is_string($id) ? Product::query()->find(strtolower($id)) : null;
        $mod->setAttribute('product_id', $product?->id);

        if (! $product instanceof Product) {
            return;
        }

        $mod->setAttribute('brand_id', $product->brand_id);
        $mod->setAttribute('brand_text', null);

        if (! is_string($attributes['part_name'] ?? null)) {
            $mod->setAttribute('part_name', $product->name);
        }
    }

    /**
     * @param  array<string, mixed>  $fields
     * @param  list<string>  $keys
     */
    private function namedAny(array $fields, array $keys): bool
    {
        foreach ($keys as $key) {
            if (is_string($fields[$key] ?? null)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Input is MM/YYYY as "YYYY-MM". A planned part is not installed yet, so it has no date.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function fillInstalled(Modification $mod, array $attributes): void
    {
        if (array_key_exists('installed_on', $attributes)) {
            $date = is_string($attributes['installed_on']) ? Carbon::createFromFormat('Y-m-d', $attributes['installed_on'].'-01')?->startOfDay() : null;

            // By the month it is in Germany (02_PRODUCT_SPEC: dates in Europe/Berlin), not by UTC: on the 1st the two differ for up to two hours.
            if ($date !== null && $date->format('Y-m') > Carbon::now(config()->string('speedclub.display_timezone'))->format('Y-m')) {
                throw ValidationException::withMessages(['installed_on' => [(string) __('garage.installed_in_future')]]);
            }

            $mod->setAttribute('installed_on', $date);
        }

        if ($mod->getAttribute('status') === ModStatus::Planned) {
            $mod->setAttribute('installed_on', null);
        }
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function fillLegalStatus(Modification $mod, array $attributes, bool $isNew): void
    {
        if ($this->flags->enabled('sig.mod_legal_status') && array_key_exists('legal_status', $attributes)) {
            $mod->setAttribute('legal_status', $attributes['legal_status'] ?? LegalStatus::Unknown);
        } elseif ($isNew) {
            $mod->setAttribute('legal_status', LegalStatus::Unknown);
        }
    }

    /**
     * Brand + model; without those whatever the category's field says, at last the category name.
     */
    private function autoTitle(Modification $mod): string
    {
        $brandId = $mod->getAttribute('brand_id');
        $brand = $brandId === null ? $mod->getAttribute('brand_text') : Brand::query()->whereKey($brandId)->value('name');
        $part = $mod->getAttribute('part_name');
        $title = trim((is_string($brand) ? $brand : '').' '.(is_string($part) ? $part : ''));

        if ($title !== '') {
            return mb_substr($title, 0, 160);
        }

        /** @var array<string, mixed> $fields */
        $fields = $mod->getAttribute('fields') ?? [];

        return is_string($fields['title'] ?? null) ? $fields['title'] : $mod->category->getTranslation('name', app()->getLocale());
    }

    /**
     * SEC-P3-15: the title the member writes ("Sonstiges" and an own title) goes through the keyword rules like a description.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, array{0: KeywordField, 1: string|null}>
     */
    public static function screened(array $attributes): array
    {
        return is_string($attributes['title'] ?? null) ? ['title' => [KeywordField::ModTitle, $attributes['title']]] : [];
    }
}
