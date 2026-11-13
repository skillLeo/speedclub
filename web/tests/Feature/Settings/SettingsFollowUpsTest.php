<?php

use App\Mail\MessageDigestMail;
use App\Models\FeatureFlag;
use App\Models\User;
use App\Services\AppConfig\AppConfig;
use Carbon\CarbonImmutable;
use Database\Seeders\FeatureFlagSeeder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';
require_once __DIR__.'/../Events/EventTestHelpers.php';

/**
 * Phase 4 lane B settings: SET-11 locale "system" and the home region (Home "Treffen in deiner Nähe", EVT-01 near=home), SET-09 web_push
 * and digest frequency, SET-25 release notes, and the flags qr_milestone, businesses, membership.
 */
describe('SET-11 locale "system"', function () {
    it('follows the device: answers "system", keeps the device language for mails, and leaves it with a fixed language', function () {
        $member = setMember(['locale' => 'de']);
        Sanctum::actingAs($member);

        $this->withHeader('Accept-Language', 'en-GB')->patchJson('/api/v1/me/settings', ['locale' => 'system'])->assertOk()
            ->assertJsonPath('data.locale', 'system')
            ->assertJsonPath('data.effective_locale', 'en');
        expect($member->fresh()?->getAttribute('locale'))->toBe('en')
            ->and($member->fresh()?->getAttribute('locale_follows_system'))->toBeTrue();

        $this->patchJson('/api/v1/me/settings', ['locale' => 'de'])->assertOk()
            ->assertJsonPath('data.locale', 'de')
            ->assertJsonPath('data.effective_locale', 'de');
        expect($member->fresh()?->getAttribute('locale_follows_system'))->toBeFalse();

        $this->patchJson('/api/v1/me/settings', ['locale' => 'fr'])->assertUnprocessable()->assertJsonValidationErrors('locale');
    });
});

describe('SET-11 home region', function () {
    it('stores the picked city snapped to the 0.05° grid, shows it to the member only, and clears it', function () {
        $member = setMember(['username' => 'jann.ptrs']);
        Sanctum::actingAs($member);

        $this->patchJson('/api/v1/me/settings', ['home_region' => ['label' => ' Hamburg ', 'lat' => 53.55108, 'lng' => 9.99368]])->assertOk()
            ->assertJsonPath('data.home_region', ['label' => 'Hamburg', 'lat' => 53.575, 'lng' => 9.975]);
        $this->getJson('/api/v1/me/settings')->assertJsonPath('data.home_region.label', 'Hamburg');

        Sanctum::actingAs(setMember());
        expect(json_encode($this->getJson('/api/v1/public/users/jann.ptrs')->assertOk()->json()))->not->toContain('home_region')->not->toContain('53.575');

        Sanctum::actingAs($member);
        $this->patchJson('/api/v1/me/settings', ['home_region' => null])->assertOk()->assertJsonPath('data.home_region', null);
    });

    it('refuses an incomplete or impossible region', function (array $region) {
        Sanctum::actingAs(setMember());

        $this->patchJson('/api/v1/me/settings', ['home_region' => $region])->assertUnprocessable();
    })->with([
        'no label' => [['lat' => 53.5, 'lng' => 10.0]],
        'latitude out of range' => [['label' => 'Nirgendwo', 'lat' => 95, 'lng' => 10.0]],
        'unknown key' => [['label' => 'Hamburg', 'lat' => 53.5, 'lng' => 10.0, 'street' => 'Am Kai 1']],
        'label too long' => [['label' => str_repeat('a', 81), 'lat' => 53.5, 'lng' => 10.0]],
    ]);

    it('needs a member', function () {
        $this->patchJson('/api/v1/me/settings', ['home_region' => null])->assertUnauthorized();
        Sanctum::actingAs(User::factory()->deactivated()->create());
        $this->patchJson('/api/v1/me/settings', ['home_region' => null])->assertForbidden();
    });

    it('feeds Home "Treffen in deiner Nähe" and EVT-01 near=home when the device gives no location', function () {
        evFlags();
        $hamburg = evEvent(attributes: ['city' => 'Hamburg', 'lat' => 53.55, 'lng' => 9.99, 'area_lat' => 53.575, 'area_lng' => 9.975]);
        $munich = evEvent(attributes: ['city' => 'München', 'lat' => 48.13, 'lng' => 11.58, 'area_lat' => 48.125, 'area_lng' => 11.575]);
        $member = setMember(['home_region_label' => 'Hamburg', 'home_region_lat' => 53.575, 'home_region_lng' => 9.975]);
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/home/modules')->assertOk()
            ->assertJsonPath('data.nearby_events.0.id', $hamburg->id)
            ->assertJsonCount(1, 'data.nearby_events');
        $this->getJson('/api/v1/events?near=home')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $hamburg->id);
        // The device location of the request wins.
        $this->getJson('/api/v1/events?near=home&lat=48.13&lng=11.58')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $munich->id);
        $this->getJson('/api/v1/events?near=everywhere')->assertUnprocessable()->assertJsonValidationErrors('near');

        // A guest, or a member without a region, lists everything.
        Sanctum::actingAs(setMember());
        $this->getJson('/api/v1/events?near=home')->assertOk()->assertJsonCount(2, 'data');
    });
});

describe('SET-09 web_push and digest frequency', function () {
    it('adds web_push to every type (starting like push) and a daily digest, and stores changes', function () {
        Sanctum::actingAs(setMember());

        $this->getJson('/api/v1/me/settings')->assertOk()
            ->assertJsonPath('data.notification_prefs.types.new_follower.web_push', true)
            ->assertJsonPath('data.notification_prefs.types.build_saved.web_push', false)
            ->assertJsonPath('data.notification_prefs.digest_frequency', 'daily');

        $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['new_follower' => ['web_push' => false]], 'digest_frequency' => 'weekly']])->assertOk()
            ->assertJsonPath('data.notification_prefs.types.new_follower.web_push', false)
            ->assertJsonPath('data.notification_prefs.types.new_follower.push', true)
            ->assertJsonPath('data.notification_prefs.digest_frequency', 'weekly');

        $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['digest_frequency' => 'hourly']])->assertUnprocessable();
        $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['new_follower' => ['fax' => true]]]])->assertUnprocessable();
    });

    it('mails a weekly digest on Mondays only', function () {
        Mail::fake();
        // A Saturday, 18:00 in Berlin; 13 hours later it is Sunday morning.
        $this->travelTo(CarbonImmutable::parse('2026-11-14 18:00', 'Europe/Berlin'));
        $lukas = ntfMember('lukas.sc', ['notification_prefs' => ['types' => ['new_message' => ['email_digest' => true]], 'digest_frequency' => 'weekly']]);
        msgStart(ntfMember('jann.ptrs'), $lukas, 'Hast du Zeit am Wochenende?');

        $this->travel(13)->hours();
        $this->artisan('messages:digest')->assertSuccessful();
        Mail::assertNothingQueued();

        // Monday 18:00.
        $this->travelTo(CarbonImmutable::parse('2026-11-16 18:00', 'Europe/Berlin'));
        $this->artisan('messages:digest')->assertSuccessful();
        Mail::assertQueued(MessageDigestMail::class, fn (MessageDigestMail $mail): bool => $mail->hasTo($lukas->email));
    });
});

describe('SET-25 release notes', function () {
    it('lists the releases newest first in the language asked for, German as the fallback, for guests too', function () {
        $path = tempnam(sys_get_temp_dir(), 'notes');
        file_put_contents($path, json_encode(['releases' => [
            ['version' => '1.0.0', 'date' => '2026-11-10', 'de' => ['title' => 'Eins', 'items' => ['Garage']], 'en' => ['title' => 'One', 'items' => ['Garage']]],
            ['version' => '2.0.0', 'date' => '2026-12-20', 'de' => ['title' => 'Zwei', 'items' => ['Treffen', 'Wartung']]],
            ['version' => 'kaputt'],
        ]]));
        config(['speedclub.release_notes_path' => $path]);
        Cache::flush();

        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/release-notes')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0', ['version' => '2.0.0', 'date' => '2026-12-20', 'title' => 'Zwei', 'items' => ['Treffen', 'Wartung']])
            ->assertJsonPath('data.1.title', 'One')
            ->assertHeader('ETag');
        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/release-notes')->assertJsonPath('data.1.title', 'Eins');

        @unlink($path);
    });

    it('ships German notes for every release in the data file', function () {
        $data = json_decode((string) file_get_contents(database_path('data/release_notes.json')), true);

        expect($data['releases'])->not->toBeEmpty();

        foreach ($data['releases'] as $release) {
            expect($release['de']['title'] ?? null)->toBeString()->and($release['de']['items'] ?? [])->not->toBeEmpty()
                ->and($release['en']['items'] ?? [])->toHaveCount(count($release['de']['items']));
        }

        $this->getJson('/api/v1/release-notes')->assertOk()->assertJsonPath('data.0.version', $data['releases'][0]['version']);
    });
});

describe('flags qr_milestone, businesses, membership', function () {
    it('reach an existing host with the data migration, off except qr_milestone outside production, and never change a row', function () {
        FeatureFlag::query()->create(['key' => 'events', 'enabled' => true, 'description' => 'x']);
        FeatureFlag::query()->create(['key' => 'membership', 'enabled' => true, 'description' => 'set by an admin']);

        (require database_path('migrations/2026_12_04_100100_add_qr_milestone_businesses_membership_flags.php'))->up();

        expect(DB::table('feature_flags')->where('key', 'qr_milestone')->value('enabled'))->toBeTruthy()
            ->and(DB::table('feature_flags')->where('key', 'businesses')->value('enabled'))->toBeFalsy()
            ->and(DB::table('feature_flags')->where('key', 'membership')->value('description'))->toBe('set by an admin')
            ->and(DB::table('feature_flags')->where('key', 'membership')->value('enabled'))->toBeTruthy();

        app(AppConfig::class)->flush();
        $this->getJson('/api/v1/app-config')->assertOk()
            ->assertJsonPath('data.flags.qr_milestone', true)
            ->assertJsonPath('data.flags.businesses', false);
    });

    it('leaves an empty flag table to the seeder, which seeds the three', function () {
        (require database_path('migrations/2026_12_04_100100_add_qr_milestone_businesses_membership_flags.php'))->up();
        expect(FeatureFlag::query()->count())->toBe(0);

        $this->seed(FeatureFlagSeeder::class);
        expect(FeatureFlag::query()->whereIn('key', ['qr_milestone', 'businesses', 'membership', 'msg_replies'])->pluck('enabled', 'key')->map(fn ($enabled): bool => (bool) $enabled)->all())
            ->toEqual(['businesses' => false, 'membership' => false, 'msg_replies' => false, 'qr_milestone' => true]);
    });

    it('brings msg_replies to an existing host off, never over an admin\'s row (ADR-445)', function () {
        FeatureFlag::query()->create(['key' => 'events', 'enabled' => true, 'description' => 'x']);
        $migration = database_path('migrations/2026_12_04_100200_add_msg_replies_flag.php');

        (require $migration)->up();
        expect(DB::table('feature_flags')->where('key', 'msg_replies')->value('enabled'))->toBeFalsy();

        DB::table('feature_flags')->where('key', 'msg_replies')->update(['enabled' => true]);
        (require $migration)->up();
        expect(DB::table('feature_flags')->where('key', 'msg_replies')->value('enabled'))->toBeTruthy()
            ->and(DB::table('feature_flags')->where('key', 'msg_replies')->count())->toBe(1);
    });
});
