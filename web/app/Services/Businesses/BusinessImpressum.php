<?php

namespace App\Services\Businesses;

use App\Models\Business;

/**
 * The Impressum block of every business page (09 §8.10, § 5 DDG; ADR-414): name and legal form, address, contact (e-mail, phone),
 * representative, register entry and VAT ID where applicable. The data is the business's own; a sample business (09 §8.19) carries
 * placeholder data and says so (`is_sample`).
 */
final class BusinessImpressum
{
    /**
     * @return array{legal_name: string, legal_form: string, legal_form_label: string, representative: string|null, street: string, postcode: string, city: string, country: string, email: string, phone: string|null, register_court: string|null, register_number: string|null, vat_id: string|null, is_sample: bool}
     */
    public static function for(Business $business): array
    {
        return [
            'legal_name' => $business->legal_name,
            'legal_form' => $business->legal_form->value,
            'legal_form_label' => $business->legal_form->label(),
            'representative' => $business->representative,
            'street' => $business->street,
            'postcode' => $business->postcode,
            'city' => $business->city,
            'country' => $business->country,
            'email' => $business->email,
            'phone' => $business->phone,
            'register_court' => $business->register_court,
            'register_number' => $business->register_number,
            'vat_id' => $business->vat_id,
            'is_sample' => $business->is_sample,
        ];
    }
}
