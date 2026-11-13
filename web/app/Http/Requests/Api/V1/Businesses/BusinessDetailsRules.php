<?php

namespace App\Http\Requests\Api\V1\Businesses;

use App\Enums\BusinessKind;
use App\Enums\BusinessLegalForm;
use Illuminate\Validation\Rule;

/**
 * The fields of BIZ-02 (application) and the profile edit (BIZ-03): company and Impressum data (§ 5 DDG), contact, services, opening
 * hours and a note on the documents staff may ask for. Opening hours and the register rule are checked by BusinessFields.
 */
final class BusinessDetailsRules
{
    /**
     * @return array<string, mixed>
     */
    public static function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';
        $max = config()->integer('speedclub.businesses.services_max');

        return [
            /** The name on the page ("Beispiel-Werkstatt Nord"). */
            'name' => [$required, 'string', 'min:2', 'max:120'],
            'kind' => [$required, Rule::enum(BusinessKind::class)],
            /** The company as registered (Impressum). */
            'legal_name' => [$required, 'string', 'min:2', 'max:160'],
            'legal_form' => [$required, Rule::enum(BusinessLegalForm::class)],
            /** Who represents the company (Geschäftsführung, Inhaber). */
            'representative' => [$creating ? 'required' : 'sometimes', 'string', 'min:3', 'max:160'],
            'street' => [$required, 'string', 'min:3', 'max:160'],
            'postcode' => [$required, 'string', 'regex:/\A[0-9A-Za-z -]{3,10}\z/'],
            'city' => [$required, 'string', 'min:2', 'max:80'],
            'country' => ['sometimes', 'string', 'size:2', Rule::in(['DE', 'AT', 'CH', 'LU', 'NL', 'BE', 'DK', 'PL', 'CZ', 'FR'])],
            /** The point on the map (BIZ-01 "Route"); optional. */
            'lat' => ['nullable', 'numeric', 'between:-90,90', 'required_with:lng'],
            'lng' => ['nullable', 'numeric', 'between:-180,180', 'required_with:lat'],
            'phone' => ['sometimes', 'nullable', 'string', 'regex:/\A\+?[0-9 ()\/-]{6,40}\z/'],
            /** Public contact address (Impressum). */
            'email' => ['bail', $required, 'string', 'max:160', 'email:rfc'],
            'website' => ['sometimes', 'nullable', 'string', 'url:https', 'max:300'],
            /** Register court and number: required for the forms with a register entry (e. K., OHG, KG, GmbH, GmbH & Co. KG, UG, AG). */
            'register_court' => ['sometimes', 'nullable', 'string', 'max:120'],
            'register_number' => ['sometimes', 'nullable', 'string', 'max:60'],
            /** USt-IdNr., optional ("DE123456789"). */
            'vat_id' => ['sometimes', 'nullable', 'string', 'regex:/\A[A-Z]{2}[0-9A-Z]{2,13}\z/'],
            'about' => ['sometimes', 'nullable', 'string', 'max:'.config()->integer('speedclub.businesses.about_max')],
            /** Service chips ("Fahrwerk", "Folierung"), at most 12. */
            'services' => ['sometimes', 'nullable', 'array', 'max:'.$max],
            'services.*' => ['string', 'min:2', 'max:'.config()->integer('speedclub.businesses.service_max'), 'distinct:ignore_case'],
            /**
             * {"mon": [["09:00", "18:00"]], ...}; days mon…sun, up to two ranges each; a day left out is closed.
             *
             * @var array<string, list<list<string>>>|null
             */
            'opening_hours' => ['sometimes', 'nullable', 'array'],
            /** BIZ-02 "Nachweise": what you can show us on request (Gewerbeanmeldung, Handelsregisterauszug); never public. */
            'document_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ];
    }
}
