<?php

use App\Http\RateLimits;
use App\Models\User;
use App\Services\Notifications\NotificationPrefs;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/NotificationTestHelpers.php';

/**
 * M2.2: notification_prefs on GET/PATCH me/settings (SET-09 in M2.5), and SEC-P1-04, the limiter on PATCH me/settings and me/profile.
 */
beforeEach(function () {
    $this->member = ntfMember('lena.911');
    Sanctum::actingAs($this->member);
});

it('answers the defaults of the matrix before anything was set', function () {
    $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.notification_prefs', [
        'types' => [
            'new_follower' => ['push' => true],
            'followed_published' => ['push' => false],
            'build_saved' => ['push' => false],
            'new_message' => ['push' => true, 'email_digest' => false],
            'message_request' => ['push' => true],
            'hu_au_reminder' => ['push' => true, 'email' => false],
            'qr_milestone' => ['push' => false],
        ],
        'quiet_hours' => ['enabled' => true, 'from' => '22:00', 'to' => '07:00'],
        'message_previews' => false,
    ]);
});

it('changes only what is sent and keeps earlier changes', function () {
    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['followed_published' => ['push' => true]]]])->assertOk()
        ->assertJsonPath('data.notification_prefs.types.followed_published.push', true)
        ->assertJsonPath('data.notification_prefs.types.new_follower.push', true);

    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['quiet_hours' => ['from' => '23:30'], 'message_previews' => true]])->assertOk()
        ->assertJsonPath('data.notification_prefs.types.followed_published.push', true)
        ->assertJsonPath('data.notification_prefs.quiet_hours', ['enabled' => true, 'from' => '23:30', 'to' => '07:00'])
        ->assertJsonPath('data.notification_prefs.message_previews', true);

    $this->patchJson('/api/v1/me/settings', ['theme' => 'light'])->assertOk()
        ->assertJsonPath('data.notification_prefs.quiet_hours.from', '23:30');

    expect(NotificationPrefs::for($this->member->refresh())['types']['followed_published']['push'])->toBeTrue();
});

it('refuses unknown keys at every level, and wrong types, with 422', function (array $prefs, string $field) {
    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => $prefs])->assertUnprocessable()
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonValidationErrors($field);

    expect($this->member->refresh()->getAttribute('notification_prefs'))->toBeNull();
})->with([
    'top level' => [['sound' => true], 'notification_prefs'],
    'type' => [['types' => ['likes' => ['push' => true]]], 'notification_prefs.types'],
    'channel' => [['types' => ['new_follower' => ['email' => true]]], 'notification_prefs.types.new_follower'],
    'quiet hours key' => [['quiet_hours' => ['zone' => 'UTC']], 'notification_prefs.quiet_hours'],
    'not a boolean' => [['types' => ['new_follower' => ['push' => 'ja']]], 'notification_prefs.types.new_follower.push'],
    'one as boolean' => [['message_previews' => 1], 'notification_prefs.message_previews'],
    'time 24:00' => [['quiet_hours' => ['from' => '24:00']], 'notification_prefs.quiet_hours.from'],
    'time 7:00' => [['quiet_hours' => ['to' => '7:00']], 'notification_prefs.quiet_hours.to'],
    'not an object' => [['types' => 'alle'], 'notification_prefs.types'],
]);

it('limits PATCH me/settings and me/profile together (SEC-P1-04)', function () {
    config(['speedclub.rate_limits.account_edits.max' => 2]);
    RateLimits::register();

    $this->patchJson('/api/v1/me/settings', ['theme' => 'light'])->assertOk();
    $this->patchJson('/api/v1/me/profile', ['city' => 'Stuttgart'])->assertOk();
    $this->patchJson('/api/v1/me/settings', ['theme' => 'carbon'])->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    $this->patchJson('/api/v1/me/profile', ['city' => 'Köln'])->assertStatus(429);

    // Another member has a bucket of their own.
    Sanctum::actingAs(User::factory()->create());
    $this->patchJson('/api/v1/me/settings', ['theme' => 'light'])->assertOk();
});

it('words the limit in both languages', function (string $locale, string $start) {
    expect(trans('rate_limits.account_edits', ['time' => '1'], $locale))->toStartWith($start);
})->with([['de', 'Du hast'], ['en', 'You have']]);

it('allows 60 edits a minute by default', function () {
    expect(config('speedclub.rate_limits.account_edits'))->toBe(['max' => 60, 'minutes' => 1]);
});
