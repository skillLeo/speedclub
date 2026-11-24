<?php

use App\Actions\Wrapped\GenerateWrappedForUser;
use App\Http\Controllers\Admin\Members\MemberWrappedPanel;
use App\Models\AuditEvent;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Wrapped/WrappedTestHelpers.php';

/**
 * ADM-10 tab "Wrapped" (M5.9e admin, m5.9e contract §2). Atoms: the record needs members.view; the tab and the card PNGs add
 * support.view (Owner, Admin, Moderator, Support; the Analyst falls back to Übersicht, the content editor has no member record);
 * "Vorschau erzeugen" adds support.reply (Owner, Admin, Support), on the route ahead of anything else, so a direct POST of another role
 * writes and audits nothing. The tab shows the member's seasons, the chosen season as WrappedPresenter words it (photos only as
 * present/absent, never a member media URL) and the staff-only PNGs (`private, no-store`). The first view of a member's season per
 * staff member and day is audited (`wrapped.viewed`), the generation by the action (`wrapped.preview_generated`).
 */
const ADM59E_VIEW = ['owner', 'admin', 'moderator', 'support'];
const ADM59E_GENERATE = ['owner', 'admin', 'support'];
const ADM59E_RECORD = ['owner', 'admin', 'moderator', 'support', 'analyst'];

beforeEach(function () {
    wrFlags();
    $this->travelTo(wrNow());
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

function adm59eAs(string $role): void
{
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));
    test()->withSession(['auth.password_confirmed_at' => time()]);
}

/** A member with a car and one mod installed in the 2027 season (enough for a Wrapped). */
function adm59eActive(): User
{
    $member = User::factory()->create();
    wrMod(wrCar($member));

    return $member;
}

function adm59eGenerated(User $member, string $season = WR_SEASON): Wrapped
{
    $wrapped = app(WrappedGenerator::class)->generate($member, Season::from($season));
    expect($wrapped)->toBeInstanceOf(Wrapped::class);

    return $wrapped;
}

/** Every key of a nested array, recursively. @return list<string> */
function adm59eKeys(mixed $value): array
{
    if (! is_array($value)) {
        return [];
    }
    $keys = [];
    foreach ($value as $key => $item) {
        $keys[] = (string) $key;
        array_push($keys, ...adm59eKeys($item));
    }

    return $keys;
}

// ---- authorisation matrix ---------------------------------------------------------------------------------------------------------

it('shows the tab to support.view and sends the analyst back to Übersicht', function () {
    $member = adm59eActive();
    adm59eGenerated($member);

    assertAdminMatrix('GET', "/admin/members/{$member->id}?tab=wrapped", ADM59E_RECORD, function (TestResponse $r, string $role): void {
        $r->assertOk()->assertInertia(function (AssertableInertia $page) use ($role) {
            $page->component('Members/Show');
            if (in_array($role, ADM59E_VIEW, true)) {
                $page->where('tab', 'wrapped')->where('wrapped.selected', WR_SEASON)->where('wrapped.can.generate', in_array($role, ADM59E_GENERATE, true));
            } else {
                $page->where('tab', 'overview')->missing('wrapped');
            }
        });
    });
});

it('serves the card PNG to support.view only', function () {
    $member = adm59eActive();
    adm59eGenerated($member);

    assertAdminMatrix('GET', "/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/1.png', ADM59E_VIEW, function (TestResponse $r): void {
        $r->assertOk()->assertHeader('Content-Type', 'image/png');
        expect((string) $r->headers->get('Cache-Control'))->toContain('private')->toContain('no-store')
            ->and($r->headers->get('X-Content-Type-Options'))->toBe('nosniff');
    });
});

it('guards "Vorschau erzeugen" by support.reply, ahead of the password check: other roles hear 403', function () {
    $member = adm59eActive();

    assertAdminMatrix('POST', "/admin/members/{$member->id}/wrapped", ADM59E_GENERATE, function (TestResponse $r): void {
        // Recent password missing: the confirm answer, never a generation.
        expect($r->status())->toBeIn([302, 303, 423]);
    }, ['season_key' => WR_SEASON]);

    expect(Wrapped::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->count())->toBe(0);
});

it('needs a recently confirmed password to generate (ADR-215)', function () {
    $member = adm59eActive();
    seedStaffRoles();
    actingAsStaff(staffWithRole('support'));
    test()->withSession(['auth.password_confirmed_at' => time() - 3600]);

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON])->assertSessionHas('confirm_password', true);

    expect(Wrapped::query()->count())->toBe(0);
});

it('generates for every role with support.reply', function (string $role) {
    $member = adm59eActive();
    adm59eAs($role);

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON])->assertStatus(303)->assertSessionHas('success', 'members.wrapped.flash.generated');

    expect(Wrapped::query()->where('user_id', $member->id)->count())->toBe(1);
})->with(ADM59E_GENERATE);

it('refuses a moderator\'s direct POST with 403 and leaves no row', function () {
    $member = adm59eActive();
    adm59eAs('moderator');

    assertAdminErrorPage($this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON]), 403);

    expect(Wrapped::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->count())->toBe(0);
});

it('counts the card PNGs and "Vorschau erzeugen" apart: looking at a preview never uses up the generate limit', function () {
    // E2E P5 gate (A5 Wrapped preview answered 429 instead of 403): an unnamed `throttle:N,M` keys on the staff member alone, so the
    // PNGs (120 a minute) and the generate POST (10 a minute) shared one counter, and a preview's cards used up the regenerate.
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eAs('support');

    foreach (range(1, 12) as $ignored) {
        $this->get("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/1.png')->assertOk();
    }
    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON])->assertStatus(303)->assertSessionHas('success', 'members.wrapped.flash.generated');
});

it('keeps the moderator\'s refusal a 403 after looking at the cards', function () {
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eAs('moderator');

    foreach (range(1, 12) as $ignored) {
        $this->get("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/1.png')->assertOk();
    }
    assertAdminErrorPage($this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON]), 403);
});

// ---- generate ------------------------------------------------------------------------------------------------------------------------

it('generates the preview, audits it without the payload and returns to the tab on that season', function () {
    $member = adm59eActive();
    adm59eAs('support');

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON])
        ->assertStatus(303)
        ->assertRedirect("/admin/members/{$member->id}?tab=wrapped&season=".WR_SEASON)
        ->assertSessionHas('success', 'members.wrapped.flash.generated');

    $event = AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->sole();
    expect(Wrapped::query()->where('user_id', $member->id)->where('season_key', WR_SEASON)->exists())->toBeTrue()
        ->and($event->target_id)->toBe($member->id)
        ->and($event->after['season_key'])->toBe(WR_SEASON)
        ->and($event->after['generated'])->toBeTrue()
        ->and($event->after)->not->toHaveKey('payload');
});

it('says so when the season has nothing to show, and writes no row', function () {
    $member = User::factory()->create();
    adm59eAs('admin');

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => '2026-saison'])->assertSessionHas('success', 'members.wrapped.flash.nothing');

    expect(Wrapped::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->sole()->after['generated'])->toBeFalse();
});

it('says so when an existing Wrapped was removed because the season has no activity any more', function () {
    $member = User::factory()->create();
    Wrapped::factory()->create(['user_id' => $member->id]);
    adm59eAs('support');

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON])->assertSessionHas('success', 'members.wrapped.flash.removed');

    expect(Wrapped::query()->count())->toBe(0);
});

it('validates the season key', function (mixed $season) {
    $member = adm59eActive();
    adm59eAs('admin');

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => $season])->assertSessionHasErrors('season_key');

    expect(AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->count())->toBe(0);
})->with(['missing' => [null], 'winter' => ['2027-winter'], 'year 1999' => ['1999-saison'], 'injected' => ['2027-saison/../x']]);

it('generates nothing for a deleted account', function () {
    $member = adm59eActive();
    $member->delete();
    adm59eAs('admin');

    $this->post("/admin/members/{$member->id}/wrapped", ['season_key' => WR_SEASON])->assertSessionHas('error', 'members.wrapped.flash.closed');

    expect(Wrapped::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->count())->toBe(0);
});

it('answers 404 for an unknown member', function () {
    adm59eAs('admin');

    $this->post('/admin/members/01JAAAAAAAAAAAAAAAAAAAAAAA/wrapped', ['season_key' => WR_SEASON])->assertNotFound();
    $this->get('/admin/members/01JAAAAAAAAAAAAAAAAAAAAAAA/wrapped/'.WR_SEASON.'/cards/1.png')->assertNotFound();
});

// ---- the tab -------------------------------------------------------------------------------------------------------------------------

it('lists the member\'s seasons newest first with generated, viewed, shared and release', function () {
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eGenerated($member, '2027-jahr');
    Wrapped::query()->where('season_key', WR_SEASON)->update(['viewed_at' => now(), 'shared_count' => 3]);
    wrRelease([WR_SEASON => '2027-11-01T10:00:00+01:00', '2027-jahr' => '2028-01-10T10:00:00+01:00']);
    adm59eAs('support');

    $this->get("/admin/members/{$member->id}?tab=wrapped")->assertInertia(fn (AssertableInertia $page) => $page
        ->has('wrapped.seasons', 2)
        ->where('wrapped.seasons.0.key', '2027-saison')
        ->where('wrapped.seasons.0.shared_count', 3)
        ->where('wrapped.seasons.0.released', true)
        ->where('wrapped.seasons.1.key', '2027-jahr')
        ->where('wrapped.seasons.1.viewed_at', null)
        ->where('wrapped.seasons.1.released', false)
        ->where('wrapped.seasons.1.release_at', '2028-01-10T10:00:00+01:00')
        ->where('wrapped.options', ['2027-saison', '2027-jahr', '2026-saison', '2026-jahr', '2025-saison', '2025-jahr']));
});

it('shows the chosen season as the member reads it, photos only as flags, each card with its staff PNG', function () {
    $member = adm59eActive();
    $wrapped = adm59eGenerated($member);
    adm59eAs('admin');

    $props = $this->get("/admin/members/{$member->id}?tab=wrapped&season=".WR_SEASON)->assertOk()->inertiaProps('wrapped');
    $preview = $props['preview'];
    $kinds = array_column($preview['cards'], 'kind');

    expect($preview['season_key'])->toBe(WR_SEASON)
        ->and($preview['window'])->toBe(['from' => '2027-03-01', 'to' => '2027-10-31'])
        ->and($kinds)->toBe(array_map(fn (array $card): string => (string) $card['kind'], $wrapped->cards()))
        ->and($preview['cards'][0]['fields']['title'])->toBe('Deine Saison 2027')
        ->and($preview['cards'][0]['image'])->toStartWith("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/1.png?v=')
        ->and(adm59eKeys($props))->not->toContain('url')->not->toContain('thumbhash')->not->toContain('avatar');

    foreach ($preview['cards'] as $card) {
        foreach (['before_media', 'after_media', 'image'] as $photo) {
            if (array_key_exists($photo, $card['fields'])) {
                expect($card['fields'][$photo])->toBeBool();
            }
        }
    }
});

it('keeps the share card QR markup out of the staff page and keeps its page link (crawl ADM-10 raw qr_svg)', function () {
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eAs('support');

    $props = $this->get("/admin/members/{$member->id}?tab=wrapped&season=".WR_SEASON)->assertOk()->inertiaProps('wrapped');
    $share = collect($props['preview']['cards'])->firstWhere('kind', 'share');

    expect($share)->not->toBeNull()
        ->and($share['fields'])->not->toHaveKey('qr_svg')
        ->and($share['fields']['qr_url'])->toBeString()->toContain('/v/')
        ->and((string) json_encode($props))->not->toContain('<svg');
});

it('shows the empty state for a season without a Wrapped and audits no view', function () {
    $member = adm59eActive();
    adm59eAs('support');

    $this->get("/admin/members/{$member->id}?tab=wrapped&season=2026-jahr")->assertInertia(fn (AssertableInertia $page) => $page
        ->where('wrapped.selected', '2026-jahr')
        ->where('wrapped.preview', null)
        ->has('wrapped.seasons', 0));

    expect(AuditEvent::query()->where('action', MemberWrappedPanel::VIEWED_EVENT)->count())->toBe(0);
});

it('falls back to the newest season for a malformed ?season', function () {
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eAs('admin');

    $this->get("/admin/members/{$member->id}?tab=wrapped&season=2027-winter")->assertInertia(fn (AssertableInertia $page) => $page->where('wrapped.selected', WR_SEASON));
});

it('audits the first view of a member\'s season a day per staff member, PNGs included', function () {
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eAs('support');

    $this->get("/admin/members/{$member->id}?tab=wrapped")->assertOk();
    $this->get("/admin/members/{$member->id}?tab=wrapped")->assertOk();
    $this->get("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/1.png')->assertOk();

    $events = AuditEvent::query()->where('action', MemberWrappedPanel::VIEWED_EVENT)->get();
    expect($events)->toHaveCount(1)
        ->and($events->first()->target_id)->toBe($member->id)
        ->and($events->first()->after)->toBe(['season_key' => WR_SEASON]);

    $this->travel(1)->days();
    $this->get("/admin/members/{$member->id}?tab=wrapped")->assertOk();
    expect(AuditEvent::query()->where('action', MemberWrappedPanel::VIEWED_EVENT)->count())->toBe(2);
});

it('does not read the Wrapped while another tab is open', function () {
    $member = adm59eActive();
    adm59eGenerated($member);
    adm59eAs('admin');

    $this->get("/admin/members/{$member->id}")->assertInertia(fn (AssertableInertia $page) => $page->where('tab', 'overview')->missing('wrapped'));
    expect(AuditEvent::query()->where('action', MemberWrappedPanel::VIEWED_EVENT)->count())->toBe(0);
});

// ---- the card PNG --------------------------------------------------------------------------------------------------------------------

it('draws the member\'s card at 1080 × 1920 and answers 404 past the last card or for a season without a Wrapped', function () {
    $member = adm59eActive();
    $wrapped = adm59eGenerated($member);
    adm59eAs('moderator');

    $png = $this->get("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/1.png')->assertOk()->getContent();
    $size = getimagesizefromstring((string) $png);
    expect($size[0] ?? null)->toBe(1080)->and($size[1] ?? null)->toBe(1920);

    $this->get("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/'.(count($wrapped->cards()) + 1).'.png')->assertNotFound();
    $this->get("/admin/members/{$member->id}/wrapped/2026-jahr/cards/1.png")->assertNotFound();
    $this->get("/admin/members/{$member->id}/wrapped/2027-winter/cards/1.png")->assertNotFound();
    $this->get("/admin/members/{$member->id}/wrapped/".WR_SEASON.'/cards/0.png')->assertNotFound();
});

it('never serves another member\'s card under a member\'s URL', function () {
    $owner = adm59eActive();
    adm59eGenerated($owner);
    $other = User::factory()->create();
    adm59eAs('admin');

    $this->get("/admin/members/{$other->id}/wrapped/".WR_SEASON.'/cards/1.png')->assertNotFound();
});
