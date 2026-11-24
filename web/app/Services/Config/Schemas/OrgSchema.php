<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use App\Mail\SupportAddress;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * `org` (M3.6 ADM-52, the operator's legal identity, Owner only via ConfigKey): the fields of OrgIdentity::FIELDS, each optional text
 * (addresses validated as e-mail, the VAT ID as an EU VAT number, default_locale de or en; values trimmed, the VAT ID normalised). The legal placeholders `[[…]]` resolve from
 * the published version (OrgIdentity::resolve()); support_email also becomes the support address the mails name (SupportAddress).
 */
final class OrgSchema extends Schema
{
    public function key(): ConfigKey
    {
        return ConfigKey::Org;
    }

    public function normalize(array $payload): array
    {
        $unknown = array_diff(array_map(strval(...), array_keys($payload)), OrgIdentity::FIELDS);

        if ($unknown !== []) {
            $this->refuse(['payload' => (string) __('content.org.field')]);
        }

        // Client round 6: values are taken as people type them. Surrounding spaces go before the checks (an address pasted with a
        // leading space was refused as "not an e-mail"); a VAT ID loses spaces, dots and dashes and is upper-cased ("de 123.456.789"
        // and "DE 123 456 789" are both stored as DE123456789).
        foreach ($payload as $field => $value) {
            if (is_string($value)) {
                $payload[$field] = trim($value);
            }
        }

        if (isset($payload['vat_id']) && is_string($payload['vat_id'])) {
            $payload['vat_id'] = self::vatId($payload['vat_id']);
        }

        $rules = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $rules[$field] = ['nullable', 'string', 'max:200'];
        }

        foreach (OrgIdentity::EMAIL_FIELDS as $field) {
            $rules[$field][] = 'email:rfc';
        }

        // A VAT ID is the country code and 2–12 characters, at least one a figure (every EU number has figures): "kaputt" upper-cased
        // would otherwise pass as "KAPUTT". + and * occur in Irish numbers.
        $rules['vat_id'][] = 'regex:/\A[A-Z]{2}(?=[0-9A-Z+*]*[0-9])[0-9A-Z+*]{2,12}\z/';
        $rules['phone'][] = 'regex:/\A\+?[0-9 ().\/-]{5,30}\z/';
        $rules['default_locale'][] = Rule::in(config('speedclub.locales'));

        // Every message names the field in the admin's language (the page shows it in the save dialog).
        $attributes = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $attributes[$field] = (string) __("content.org.fields.$field");
        }

        Validator::make($payload, $rules, [
            'vat_id.regex' => (string) __('content.org.vat_id'),
            'phone.regex' => (string) __('content.org.phone'),
        ], $attributes)->validate();

        $normalized = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $value = $payload[$field] ?? null;
            $normalized[$field] = is_string($value) && $value !== '' ? $value : null;
        }

        return $normalized;
    }

    /** "de 123.456-789" → "DE123456789": spaces, dots and dashes out, upper case. */
    public static function vatId(string $value): string
    {
        return strtoupper((string) preg_replace('/[\s.\-]+/u', '', $value));
    }

    public function initial(): array
    {
        return array_fill_keys(OrgIdentity::FIELDS, null);
    }

    public function published(array $payload): void
    {
        DB::afterCommit(function (): void {
            OrgIdentity::forget();
            SupportAddress::forget();
        });
    }
}
