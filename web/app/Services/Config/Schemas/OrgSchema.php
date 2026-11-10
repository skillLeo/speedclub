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
 * (addresses validated as e-mail, the VAT ID as an EU VAT number, default_locale de or en). The legal placeholders `[[…]]` resolve from
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
        $rules = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $rules[$field] = ['nullable', 'string', 'max:200'];
        }

        foreach (OrgIdentity::EMAIL_FIELDS as $field) {
            $rules[$field][] = 'email:rfc';
        }

        $rules['vat_id'][] = 'regex:/\A[A-Z]{2}[0-9A-Z+*.]{2,12}\z/';
        $rules['phone'][] = 'regex:/\A\+?[0-9 ()\/-]{5,30}\z/';
        $rules['default_locale'][] = Rule::in(config('speedclub.locales'));

        $unknown = array_diff(array_map(strval(...), array_keys($payload)), OrgIdentity::FIELDS);

        if ($unknown !== []) {
            $this->refuse(['payload' => (string) __('content.org.field')]);
        }

        Validator::make($payload, $rules)->validate();
        $normalized = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $value = $payload[$field] ?? null;
            $normalized[$field] = is_string($value) && trim($value) !== '' ? trim($value) : null;
        }

        return $normalized;
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
