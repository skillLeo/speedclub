<?php

use App\Http\Requests\Api\V1\Garage\ModificationRequest;
use App\Http\Requests\Api\V1\Garage\VehicleAttributesRequest;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;

/**
 * These answers only reach a malformed client, but they are still sentences for people: no format text like "Y-m", no field key, in
 * both languages (copy review on the close-out). Through the real rules of the request, so the line and the rule stay together.
 */
it('words a malformed field for a person', function (string $locale, string $request, string $field, string $value, string $message) {
    app()->setLocale($locale);

    /** @var FormRequest $form */
    $form = new $request;
    $rules = Arr::only($form->rules(), $field);

    expect($rules)->not->toBe([])
        ->and(Validator::make([$field => $value], $rules)->errors()->first($field))->toBe($message);
})->with([
    'de, month of installation' => ['de', ModificationRequest::class, 'installed_on', 'x', 'Einbaumonat muss das Format JJJJ-MM haben.'],
    'en, month of installation' => ['en', ModificationRequest::class, 'installed_on', 'x', 'The month of installation must use the format YYYY-MM.'],
    'de, inspection date' => ['de', VehicleAttributesRequest::class, 'hu_au_due', 'x', 'HU/AU-Termin muss das Format JJJJ-MM haben.'],
    'en, inspection date' => ['en', VehicleAttributesRequest::class, 'hu_au_due', 'x', 'The inspection date must use the format YYYY-MM.'],
    'de, field list' => ['de', ModificationRequest::class, 'fields', 'x', 'Feldliste muss eine Liste von Feldern sein.'],
    'en, field list' => ['en', ModificationRequest::class, 'fields', 'x', 'The field list must be a list of fields.'],
    'de, ulid' => ['de', VehicleAttributesRequest::class, 'cover_media_id', 'x', 'Titelbild muss eine gültige ULID sein.'],
    'en, ulid' => ['en', VehicleAttributesRequest::class, 'cover_media_id', 'x', 'The cover photo field must be a valid ULID.'],
]);

/**
 * Leftovers of the translation package (recheck round 3, RESULT 8): literal dictionary words for field names, and the "Sie" form the app
 * never uses.
 */
it('names fields as the app does and speaks in du form', function (string $rule, string $field, mixed $value, string $message) {
    app()->setLocale('de');

    expect(Validator::make([$field => $value], [$field => $rule])->errors()->first($field))->toBe($message);
})->with([
    'slug' => ['max:3', 'slug', 'abcd', 'Webadresse darf maximal 3 Zeichen haben.'],
    'body' => ['max:3', 'body', 'abcd', 'Text darf maximal 3 Zeichen haben.'],
    'cover' => ['max:3', 'cover', 'abcd', 'Titelbild darf maximal 3 Zeichen haben.'],
]);

it('words the leaked-password message in du form', function () {
    app()->setLocale('de');
    $message = (string) __('validation.password.uncompromised', ['attribute' => 'Passwort']);

    expect($message)->toBe('Passwort ist in einem Datenleck aufgetaucht. Wähl bitte ein anderes.')
        ->and(collect(Arr::dot((array) trans('validation', [], 'de')))->filter(fn ($line): bool => is_string($line) && preg_match('/\b(Sie|Ihr|Ihre|Ihren)\b/u', $line) === 1)->all())->toBe([]);
});
