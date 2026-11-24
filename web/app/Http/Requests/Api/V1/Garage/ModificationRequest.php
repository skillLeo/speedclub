<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Enums\LegalStatus;
use App\Enums\ModPriority;
use App\Enums\ModStatus;
use App\Enums\ProductStatus;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Product;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * The fields common to every category (02_PRODUCT_SPEC §3.3). `fields` is checked against the schema of the category by
 * App\Services\Garage\ModFields, because that schema is data. POST needs `category`; on PATCH the category cannot change, and only
 * the keys sent change, `fields` as a whole.
 */
class ModificationRequest extends FormRequest
{
    public const FIRST_TARGET_MONTH = '2000-01';

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Key from catalog/mod-categories. */
            'category' => $this->isMethod('POST')
                ? ['required', 'string', Rule::exists(ModCategory::class, 'key')->where('active', true)]
                : ['prohibited'],
            /** Brand + model when left out. */
            'title' => ['sometimes', 'nullable', 'string', 'max:160'],
            'brand_id' => ['sometimes', 'nullable', 'integer', Rule::exists(Brand::class, 'id')],
            'brand_text' => ['sometimes', 'nullable', 'string', 'max:120', 'prohibits:brand_id'],
            /**
             * M4.14 (09 §8.9): a product of the parts catalogue (products search); sets the brand and, when no part name is sent, the
             * part name. Null unlinks it; free text stays possible. Ignored while the flag parts_catalogue is off.
             */
            'product_id' => ['sometimes', 'nullable', 'string', 'size:26', Rule::exists(Product::class, 'id')->where('status', ProductStatus::Active->value)],
            'part_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'part_number' => ['sometimes', 'nullable', 'string', 'max:80'],
            'status' => ['sometimes', Rule::enum(ModStatus::class)],
            /** Month of installation as YYYY-MM. Dropped for a planned part. */
            'installed_on' => ['sometimes', 'nullable', 'date_format:Y-m'],
            /** Private, always: only the owner reads it (09 §11). */
            'cost_cents' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            /** Ignored since M4.9 (costs are never public); accepted so older apps keep working. */
            'cost_public' => ['sometimes', 'boolean'],
            /** Ignored while the flag sig.mod_legal_status is off. */
            'legal_status' => ['sometimes', 'nullable', Rule::enum(LegalStatus::class)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            /** Key and value per the category's schema, unknown keys are refused. */
            'fields' => ['sometimes', 'array'],
            /**
             * M5.3 "Pläne": the target month of a planned mod as YYYY-MM, from 2000-01 to ten years ahead (a past month stays valid, so an
             * overdue plan saves unchanged). Dropped for a mod that is not planned.
             */
            'target_month' => ['sometimes', 'nullable', 'date_format:Y-m', 'after_or_equal:'.self::FIRST_TARGET_MONTH, 'before_or_equal:'.self::lastTargetMonth()],
            /** M5.3: optional priority of a planned mod. Dropped for a mod that is not planned. */
            'priority' => ['sometimes', 'nullable', Rule::enum(ModPriority::class)],
            /** M5.3: the planned budget. Private, always: only the owner reads it, like the cost. */
            'budget_cents' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            /** Kept by the server: the order of the plans changes through PUT vehicles/{id}/plans/order. */
            'plan_sort' => ['prohibited'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        $range = (string) __('garage.target_month_range', ['max' => Carbon::createFromFormat('Y-m-d', self::lastTargetMonth().'-01')?->format('m/Y')]);

        return ['target_month.after_or_equal' => $range, 'target_month.before_or_equal' => $range];
    }

    /**
     * Ten years from the current month in Germany (02_PRODUCT_SPEC: dates in Europe/Berlin).
     */
    public static function lastTargetMonth(): string
    {
        return Carbon::now(config()->string('speedclub.display_timezone'))->startOfMonth()->addYears(10)->format('Y-m');
    }
}
