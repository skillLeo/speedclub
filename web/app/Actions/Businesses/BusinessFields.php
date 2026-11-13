<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessLegalForm;
use App\Models\Business;
use App\Services\Businesses\BusinessHours;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The checks of BIZ-02/03 that span fields: a register entry for the forms that have one (§ 5 DDG), valid opening hours, services
 * trimmed. And the business's slug ("beispiel-werkstatt-nord"), stable for its life.
 */
final class BusinessFields
{
    /**
     * Fills $business from validated data (only the keys present) and checks the result as a whole.
     *
     * @param  array<string, mixed>  $data
     *
     * @throws ValidationException
     */
    public static function fill(Business $business, array $data): void
    {
        if (array_key_exists('opening_hours', $data)) {
            $hours = BusinessHours::normalise($data['opening_hours']);

            if ($hours === null) {
                throw ValidationException::withMessages(['opening_hours' => [(string) __('parts.hours_invalid')]]);
            }

            $data['opening_hours'] = $hours === [] ? null : $hours;
        }

        if (array_key_exists('services', $data)) {
            $services = is_array($data['services']) ? array_values(array_filter(array_map(fn (mixed $service): string => is_string($service) ? trim($service) : '', $data['services']), fn (string $service): bool => $service !== '')) : [];
            $data['services'] = $services === [] ? null : $services;
        }

        foreach (['vat_id', 'register_court', 'register_number', 'phone', 'website', 'about', 'document_note', 'representative'] as $key) {
            if (array_key_exists($key, $data) && is_string($data[$key]) && trim($data[$key]) === '') {
                $data[$key] = null;
            }
        }

        $business->fill($data);

        $form = $business->getAttribute('legal_form');
        $form = $form instanceof BusinessLegalForm ? $form : BusinessLegalForm::tryFrom((string) $form);

        if ($form !== null && $form->needsRegister() && (blank($business->getAttribute('register_court')) || blank($business->getAttribute('register_number')))) {
            throw ValidationException::withMessages(['register_number' => [(string) __('parts.register_required')]]);
        }
    }

    public static function slug(string $name, string $city): string
    {
        $base = Str::limit(Str::slug($name, '-', 'de'), 100, '') ?: 'betrieb';
        $base = rtrim($base, '-');

        foreach ([$base, rtrim(Str::limit($base.'-'.Str::slug($city, '-', 'de'), 120, ''), '-')] as $candidate) {
            if (strlen($candidate) >= 3 && ! Business::query()->where('slug', $candidate)->exists()) {
                return $candidate;
            }
        }

        do {
            $slug = $base.'-'.Str::lower(Str::random(4));
        } while (Business::query()->where('slug', $slug)->exists());

        return $slug;
    }
}
