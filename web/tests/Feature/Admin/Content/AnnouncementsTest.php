<?php

use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ConfigKey;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * ADM-30: DE/EN, CTA to an internal path or an https URL, audience, schedule, dismissible, all in app-config for the app to apply.
 */
beforeEach(function () {
    $this->editor = m31Staff('content_editor');
});

function m35Announcement(array $overrides = []): array
{
    return array_replace_recursive([
        'title' => ['de' => 'Neu: QR-Sticker', 'en' => 'New: QR stickers'],
        'body' => ['de' => 'Bestelle deinen Sticker in der Garage.', 'en' => 'Order your sticker in the garage.'],
        'cta' => ['label' => ['de' => 'Zur Garage', 'en' => 'To the garage'], 'url' => '/garage'],
        'audience' => 'with_vehicles',
        'dismissible' => false,
        'severity' => 'info',
    ], $overrides);
}

it('publishes announcements to app-config with id, CTA, audience and schedule', function () {
    $draft = app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Announcements, ['items' => [
        m35Announcement(['ends_at' => now()->addWeek()->toIso8601String()]),
        m35Announcement(['starts_at' => now()->addDay()->toIso8601String()]),
    ]], null);
    app(PublishConfigVersion::class)->handle($this->editor, ConfigKey::Announcements, m35Reason(), 1);

    $id = $draft->payload['items'][0]['id'];
    expect($id)->toMatch('/\A[0-9a-hjkmnp-tv-z]{26}\z/');

    $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/app-config')
        ->assertJsonCount(1, 'data.announcements')
        ->assertJsonPath('data.announcements.0.id', $id)
        ->assertJsonPath('data.announcements.0.title', 'New: QR stickers')
        ->assertJsonPath('data.announcements.0.link', '/garage')
        ->assertJsonPath('data.announcements.0.cta_label', 'To the garage')
        ->assertJsonPath('data.announcements.0.audience', 'with_vehicles')
        ->assertJsonPath('data.announcements.0.dismissible', false);
});

it('refuses unsafe links, missing texts and a reversed schedule', function (array $item, string $field) {
    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Announcements, ['items' => [$item]], null))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey($field));
})->with([
    'javascript link' => [m35Announcement(['cta' => ['url' => 'javascript:alert(1)']]), 'items.0.cta.url'],
    'protocol-relative link' => [m35Announcement(['cta' => ['url' => '//evil.example']]), 'items.0.cta.url'],
    'http link' => [m35Announcement(['cta' => ['url' => 'http://example.com']]), 'items.0.cta.url'],
    'no German title' => [m35Announcement(['title' => ['de' => null]]), 'items.0.title.de'],
    'unknown audience' => [m35Announcement(['audience' => 'vip']), 'items.0.audience'],
    'ends before start' => [m35Announcement(['starts_at' => now()->addDay()->toIso8601String(), 'ends_at' => now()->toIso8601String()]), 'items.0.ends_at'],
]);

it('accepts an https link and keeps at most 10 items', function () {
    expect(app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Announcements, ['items' => [m35Announcement(['cta' => ['url' => 'https://speedclub.de/app-laden']])]], null)->payload['items'][0]['cta']['url'])
        ->toBe('https://speedclub.de/app-laden');

    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Announcements, ['items' => array_fill(0, 11, m35Announcement())], 1))
        ->toThrow(ValidationException::class);
});
