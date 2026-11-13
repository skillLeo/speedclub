<?php

use App\Models\Block;
use App\Models\Staff;
use App\Models\User;
use App\Models\VehicleSpec;
use App\Services\PublicPages\OgImages;
use App\Services\Signature\DrawShareCards;
use App\Services\Signature\Placard;
use App\Services\Signature\ShareCards;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';

/**
 * M2.7 [SIG sig.share_cards] GET vehicles/{id}/share-card.png and share_card_url, [SIG sig.placard_pdf] GET vehicles/{vehicle}/placard.pdf
 * (m2.7-contract §1, VEH-07, QR-02).
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    sigFlag('sig.share_cards');
    sigFlag('sig.placard_pdf');
    [$this->vehicle, $this->media] = sigVehicleWithPhoto(bytes: sigDetailedJpeg(1200, 800));
    $this->owner = $this->vehicle->owner;
    VehicleSpec::factory()->create(['vehicle_id' => $this->vehicle->id, 'power_value' => 510, 'power_unit' => 'ps', 'power_ps' => 510, 'torque_nm' => 650]);
    modIn($this->vehicle, 'suspension', ['type' => 'coilover'], ['title' => 'KW V3', 'status' => 'installed']);
});

describe('share cards', function () {
    it('draws a story and a square PNG of exactly the right size', function (string $format, int $width, int $height) {
        $response = $this->get("/api/v1/vehicles/{$this->vehicle->id}/share-card.png?format=$format")->assertOk()
            ->assertHeader('Content-Type', 'image/png');

        expect($response->headers->get('Cache-Control'))->toContain('no-store');
        $size = getimagesizefromstring((string) $response->getContent());
        expect([$size[0], $size[1]])->toBe([$width, $height]);
    })->with([
        'story' => ['story', 1080, 1920],
        'square' => ['square', 1080, 1080],
    ]);

    it('stores the cards under a content hash, offers them as share_card_url, and draws new ones after a change', function () {
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk();
        $urls = $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->json('data.share_card_url');

        expect($urls['story'])->toMatch('#/storage/share/'.strtolower($this->vehicle->id).'/[0-9a-f]{40}-story\.png$#')
            ->and($urls['square'])->toEndWith('-square.png');

        $before = Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id));
        expect($before)->toHaveCount(2);

        // A new title draws new files and the old ones go.
        $this->vehicle->forceFill(['model_year' => 1999, 'generation_id' => null, 'nickname' => 'Neu'])->save();
        $this->vehicle->owner->forceFill(['username' => 'neu.name'])->save();
        app(ShareCards::class)->drawAll($this->vehicle->fresh(ShareCards::RELATIONS));

        $after = Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id));
        expect($after)->toHaveCount(2)->and(array_intersect($after, $before))->toBe([]);
    });

    it('leaves the @username out when the owner hides it (ADR-148 a)', function () {
        $shown = app(ShareCards::class)->path($this->vehicle->fresh(ShareCards::RELATIONS), 'story');
        $this->owner->forceFill(['show_owner_on_qr' => false])->save();

        expect(app(ShareCards::class)->path($this->vehicle->fresh(ShareCards::RELATIONS), 'story'))->not->toBe($shown);
    });

    it('never stores the card of a private build, and takes stored cards down when the build goes private', function () {
        app(ShareCards::class)->drawAll($this->vehicle->fresh(ShareCards::RELATIONS));
        expect(Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id)))->toHaveCount(2);

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();

        expect(Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id)))->toBe([]);

        // The owner still gets the card, drawn per request and never stored.
        $this->get("/api/v1/vehicles/{$this->vehicle->id}/share-card.png")->assertOk();
        expect(Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id)))->toBe([])
            ->and($this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->json('data.share_card_url'))->toBe(['story' => null, 'square' => null]);
    });

    it('removes what is outdated or no longer public in the daily sweep', function () {
        app(ShareCards::class)->drawAll($this->vehicle->fresh(ShareCards::RELATIONS));
        Storage::disk('public')->put('share/'.strtolower($this->vehicle->id).'/'.str_repeat('a', 40).'-story.png', 'old');
        Storage::disk('public')->put('share/01zzzzzzzzzzzzzzzzzzzzzzzz/'.str_repeat('b', 40).'-story.png', 'gone');

        $this->artisan('og:prune')->assertSuccessful();

        expect(Storage::disk('public')->allFiles('share'))->toHaveCount(2)
            ->and(Storage::disk('public')->exists('share/01zzzzzzzzzzzzzzzzzzzzzzzz/'.str_repeat('b', 40).'-story.png'))->toBeFalse();
    });

    it('queues the drawing with the OG image after a change, only while the flag is on', function () {
        Queue::fake();

        app(OgImages::class)->queue($this->vehicle);
        Queue::assertPushed(DrawShareCards::class, fn (DrawShareCards $job): bool => $job->vehicleId === $this->vehicle->id);
    });

    it('answers 404 for a vehicle the viewer may not see, and the same for one without a photo', function (Closure $hide) {
        $viewer = $hide($this->vehicle);

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        }

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/share-card.png")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    })->with([
        'private' => [fn ($vehicle) => $vehicle->forceFill(['visibility' => 'private'])->save() && false],
        'owner blocked the viewer' => [function ($vehicle): User {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $vehicle->owner_id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }],
        'no photo' => [fn ($vehicle) => $vehicle->media()->delete() && $vehicle->forceFill(['cover_media_id' => null])->save() && false],
        'unknown' => [fn ($vehicle) => $vehicle->forceDelete() && false],
    ]);

    it('validates the format', function () {
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/share-card.png?format=banner")->assertUnprocessable()->assertJsonValidationErrors('format');
    });

    it('does not exist while the flag is off, and the resource says null', function () {
        sigFlag('sig.share_cards', false);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/share-card.png")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->assertJsonPath('data.share_card_url', null);
    });
});

/**
 * The faces a PDF embeds, by PostScript name without the subset prefix ("ABCDEF+").
 *
 * @return list<string>
 */
function placardFonts(string $pdf): array
{
    preg_match_all('~/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)~', $pdf, $names);
    $fonts = array_values(array_unique($names[1]));
    sort($fonts);

    return $fonts;
}

/**
 * The code points each embedded face draws, per CIDFont dictionary (dompdf writes Identity-H, so a CID is the code point), read from /W.
 *
 * @return array<string, list<list<int>>>
 */
function placardGlyphs(string $pdf): array
{
    preg_match_all('~/Subtype /CIDFontType2\s*/BaseFont /(?:[A-Z]{6}\+)?([A-Za-z0-9-]+).*?/W \[(.*?)\]\s*/~s', $pdf, $fonts, PREG_SET_ORDER);
    $glyphs = [];

    foreach ($fonts as [, $name, $widths]) {
        $cids = [];
        // "c [w1 w2 …]" covers c, c+1, …; "first last w" covers the range.
        preg_match_all('~(\d+)\s*\[([^\]]*)\]|(\d+)\s+(\d+)\s+\d+(?:\.\d+)?~', $widths, $entries, PREG_SET_ORDER);

        foreach ($entries as $entry) {
            if (($entry[2] ?? '') !== '' || ($entry[1] ?? '') !== '') {
                $count = count(preg_split('~\s+~', trim($entry[2]), -1, PREG_SPLIT_NO_EMPTY) ?: []);
                array_push($cids, ...range((int) $entry[1], (int) $entry[1] + max($count, 1) - 1));
            } else {
                array_push($cids, ...range((int) $entry[3], (int) $entry[4]));
            }
        }

        $glyphs[$name][] = $cids;
    }

    return $glyphs;
}

describe('placard PDF', function () {
    it('gives the owner an A5 and an A4 build sheet', function (string $size, float $widthPt) {
        Sanctum::actingAs($this->owner);

        $response = $this->get("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf?size=$size")->assertOk()
            ->assertHeader('Content-Type', 'application/pdf');
        $pdf = (string) $response->getContent();

        expect($pdf)->toStartWith('%PDF-')
            ->and($response->headers->get('Content-Disposition'))->toContain('speedclub-placard-'.$size)
            ->and($pdf)->toMatch('#/MediaBox \[0(\.0+)? 0(\.0+)? '.floor($widthPt).'#')
            // 09 §4.2: the car's name in Archivo SemiExpanded, the rest in Inter, all embedded, and no other face.
            ->and(placardFonts($pdf))->toBe(['ArchivoSemiExpanded-SemiBold', 'Inter-Regular', 'Inter-SemiBold'])
            ->and(substr_count($pdf, '/FontFile2'))->toBe(3);
    })->with([
        'a5' => ['a5', 419.53],
        'a4' => ['a4', 595.28],
    ]);

    it('prints a Cyrillic model name in Inter SemiBold, the registered fallback of Archivo at the same weight', function () {
        // Free text from the member (make_text/model_text): Archivo has no Cyrillic, and the core font after it only WinAnsi.
        $this->vehicle->forceFill(['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Lada', 'model_text' => 'Лада 2107'])->save();
        Sanctum::actingAs($this->owner);

        $pdf = (string) $this->get("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf?size=a5")->assertOk()->getContent();
        $cyrillic = [mb_ord('Л'), mb_ord('а'), mb_ord('д')];
        $glyphs = placardGlyphs($pdf);

        // The same three faces, the SemiBold twice (bold for the headings, 600 for the fallback), and the letters drawn from Inter, not left blank.
        expect(placardFonts($pdf))->toBe(['ArchivoSemiExpanded-SemiBold', 'Inter-Regular', 'Inter-SemiBold'])
            ->and(substr_count($pdf, '/FontFile2'))->toBe(4)
            ->and(collect($glyphs['Inter-SemiBold'])->contains(fn (array $cids): bool => array_diff($cyrillic, $cids) === []))->toBeTrue()
            ->and(array_intersect($cyrillic, ...$glyphs['ArchivoSemiExpanded-SemiBold']))->toBe([])
            // The Latin part of the title stays in Archivo.
            ->and(in_array(mb_ord('L'), $glyphs['ArchivoSemiExpanded-SemiBold'][0], true))->toBeTrue();
    });

    it('holds the title, the specs, the mods and the code, and leaves a hidden owner out', function () {
        $qr = $this->vehicle->activeQrCode()->firstOrFail();
        $data = app(Placard::class)->viewData($this->vehicle->load(['owner', 'specs', 'modifications.category.fields', 'cover', 'media']), $qr, 'a5');

        expect($data['title'])->not->toBe('')
            ->and($data['photo'])->toStartWith('data:image/jpeg;base64,')
            ->and($data['qr_image'])->toStartWith('data:image/png;base64,')
            ->and(collect($data['mod_groups'])->pluck('items')->flatten()->implode(' '))->toContain('KW V3')
            ->and($data['username'])->toBe('finn.jdm');

        $this->owner->forceFill(['show_owner_on_qr' => false])->save();
        expect(app(Placard::class)->viewData($this->vehicle->fresh(['owner', 'specs', 'modifications.category.fields', 'cover', 'media']), $qr, 'a5')['username'])->toBeNull();
    });

    it('runs dompdf without remote access, inside a chroot of the fonts and the brand folder only (SEC-P1-11)', function () {
        expect(Placard::chroot())->toBe([resource_path('fonts'), storage_path('fonts'), public_path('brand')])
            ->and(Placard::chroot())->not->toContain(base_path());

        Sanctum::actingAs($this->owner);
        $this->get("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf")->assertOk();

        $options = app(Placard::class)->configure(app('dompdf.wrapper'))->getDomPDF()->getOptions();
        expect($options->getIsRemoteEnabled())->toBeFalse()
            ->and($options->getIsPhpEnabled())->toBeFalse()
            ->and($options->getChroot())->toBe(Placard::chroot());

        // A file outside the chroot never reaches a PDF: dompdf refuses to read it.
        $pdf = app(Placard::class)->configure(app('dompdf.wrapper'));
        $pdf->loadHTML('<img src="'.base_path('composer.json').'"><img src="'.storage_path('logs').'/x.png">');
        $pdf->output();
        expect(collect($GLOBALS['_dompdf_warnings'] ?? [])->implode(' '))->toContain('Permission denied');
    });

    it('lets only the owner download it', function (Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $this->get("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf", ['Accept' => 'application/json'])->assertStatus($status);
    })->with([
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): ?User => $owner, 200],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403],
        'member the owner blocked (SEC-P1-10)' => [function (User $owner): User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 404],
    ]);

    it('answers 404 for another member\'s private vehicle and for a vehicle without an active code', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf")->assertNotFound();

        Sanctum::actingAs($this->owner);
        $this->vehicle->qrCodes()->update(['status' => 'revoked']);
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf")->assertNotFound();
    });

    it('does not take a staff session, validates the size, and does not exist while the flag is off', function () {
        $this->actingAs(Staff::factory()->create(), 'staff');
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf")->assertUnauthorized();

        Sanctum::actingAs($this->owner);
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf?size=a3")->assertUnprocessable()->assertJsonValidationErrors('size');

        sigFlag('sig.placard_pdf', false);
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/placard.pdf")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});
