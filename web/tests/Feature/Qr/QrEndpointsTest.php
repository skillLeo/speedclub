<?php

use App\Actions\Garage\DeleteVehicle;
use App\Actions\Qr\ReissueQrCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\QrRevocationReason;
use App\Enums\QrScanState;
use App\Enums\QrStatus;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Services\Qr\QrResolution;
use App\Services\Qr\QrScans;
use App\Services\Qr\QrSticker;
use App\Support\Codes;
use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Data\AlphaNum;
use chillerlan\QRCode\Data\QRMatrix;
use chillerlan\QRCode\QRCode as Library;
use chillerlan\QRCode\QROptions;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';
require_once __DIR__.'/QrTestHelpers.php';

const QR_BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

beforeEach(function () {
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
});

/**
 * ownerOnlyMatrix with SEC-P1-10: a member on either side of a block may not see the vehicle at all, so the owner routes answer 404 for them,
 * as GET vehicles/{id} does, instead of telling that it exists with a 403. Another member who may see it still gets 403.
 *
 * @return array<string, array{0: Closure, 1: int}>
 */
function qrOwnerOnlyMatrix(): array
{
    $matrix = ownerOnlyMatrix(200);
    $matrix['member the owner blocked'][1] = 404;
    $matrix['member who blocked the owner'][1] = 404;

    return $matrix;
}

/**
 * The owner-only part of the matrix, staff and restrictions on top of ownerOnlyMatrix.
 *
 * @return array<string, array{0: string, 1: string}>
 */
function qrRoutes(): array
{
    return [
        'card' => ['get', '/qr'],
        'stats' => ['get', '/qr/stats'],
        'svg' => ['get', '/qr.svg'],
        'png' => ['get', '/qr.png'],
        'pdf' => ['get', '/qr.pdf'],
        'reissue' => ['post', '/qr/reissue'],
    ];
}

/**
 * @param  array<string, string>  $headers
 */
function qrCall(string $method, Vehicle $vehicle, string $suffix, array $headers = []): mixed
{
    $url = '/api/v1/vehicles/'.$vehicle->id.$suffix;

    return $method === 'post' ? test()->postJson($url, [], $headers) : test()->getJson($url, $headers);
}

describe('authorisation matrix', function () {
    it('lets the owner in and nobody else', function (string $method, string $suffix, Closure $who, int $status) {
        FeatureFlag::query()->create(['key' => 'sig.qr_stats', 'enabled' => true]);
        $viewer = $who($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        qrCall($method, $this->vehicle, $suffix)->assertStatus($status);
    })->with(qrRoutes())->with(qrOwnerOnlyMatrix());

    it('answers 404 for another member\'s private vehicle, as GET vehicles/{id} does (SEC-P1-10)', function (string $method, string $suffix) {
        FeatureFlag::query()->create(['key' => 'sig.qr_stats', 'enabled' => true]);
        $this->vehicle->forceFill(['visibility' => 'private'])->save();
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id)->assertNotFound();
        qrCall($method, $this->vehicle, $suffix)->assertNotFound();

        Sanctum::actingAs($this->owner);
        qrCall($method, $this->vehicle, $suffix)->assertSuccessful();
    })->with(qrRoutes());

    it('does not take a staff session for a member', function (string $method, string $suffix) {
        $this->actingAs(Staff::factory()->create(), 'staff');

        qrCall($method, $this->vehicle, $suffix)->assertUnauthorized();
    })->with(qrRoutes());

    it('keeps everything open under a publishing restriction, so a seller can cut a sticker off', function (string $method, string $suffix) {
        FeatureFlag::query()->create(['key' => 'sig.qr_stats', 'enabled' => true]);
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = publishedVehicle($member);
        app(QrCodes::class)->ensureActive($vehicle);
        Sanctum::actingAs($member);

        qrCall($method, $vehicle, $suffix)->assertOk();
    })->with(qrRoutes());

    it('lets a suspended owner read but not replace', function () {
        $member = User::factory()->suspended()->create();
        $vehicle = publishedVehicle($member);
        app(QrCodes::class)->ensureActive($vehicle);
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/vehicles/'.$vehicle->id.'/qr')->assertOk();
        $this->postJson('/api/v1/vehicles/'.$vehicle->id.'/qr/reissue')->assertForbidden();
    });

    it('stops a member who must replace the password', function () {
        $member = User::factory()->create();
        $member->forceFill(['force_password_change' => true])->save();
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/me/qr-codes')->assertForbidden()->assertJsonPath('code', 'password_change_required');
    });

    it('answers 401 to a guest on the list', function () {
        $this->getJson('/api/v1/me/qr-codes')->assertUnauthorized();
    });
});

describe('GET me/qr-codes', function () {
    it('lists one row per published vehicle with its status, main first, without drafts or anything of others', function () {
        $main = publishedVehicle($this->owner, ['is_main' => true]);
        $mainQr = app(QrCodes::class)->ensureActive($main);
        $hidden = publishedVehicle($this->owner, ['visibility' => 'private']);
        app(QrCodes::class)->ensureActive($hidden);
        Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        app(QrCodes::class)->ensureActive(publishedVehicle());

        Sanctum::actingAs($this->owner);

        $response = $this->getJson('/api/v1/me/qr-codes')->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.vehicle.id', $main->id)
            ->assertJsonPath('data.0.code', $mainQr->code)
            ->assertJsonPath('data.0.status', 'active')
            ->assertJsonPath('data.0.scan_state', 'active');

        $row = collect($response->json('data'))->firstWhere('vehicle.id', $hidden->id);

        expect($row['status'])->toBe('active')->and($row['scan_state'])->toBe('private');
    });

    it('pages by cursor and refuses a forged one', function () {
        publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $first = $this->getJson('/api/v1/me/qr-codes?per_page=1')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/me/qr-codes?per_page=1&cursor='.$first->json('meta.next_cursor'))->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/me/qr-codes?cursor=forged')->assertUnprocessable();
    });
});

describe('GET vehicles/{id}/qr', function () {
    it('gives QR-02 what it displays', function () {
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr')->assertOk()
            ->assertJsonPath('data.code', $this->qr->code)
            ->assertJsonPath('data.display_code', substr($this->qr->code, 0, 4).' '.substr($this->qr->code, 4))
            ->assertJsonPath('data.url', rtrim(config('app.url'), '/').'/C/'.$this->qr->code)
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.vehicle.public_url', url('/v/'.$this->vehicle->canonicalSlug()))
            ->assertJsonStructure(['data' => ['downloads' => ['svg', 'png_1024', 'png_2048', 'pdf']]]);
    });

    it('has nothing for a draft', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$draft->id.'/qr')->assertNotFound()->assertJsonPath('code', 'not_found');
    });

    it('answers 404 for a vehicle that does not exist', function () {
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/01JAAAAAAAAAAAAAAAAAAAAAAA/qr')->assertNotFound();
    });

    it('shows a code staff took down as revoked, with nothing to download', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Moderation);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr')->assertOk()
            ->assertJsonPath('data.status', 'revoked')
            ->assertJsonPath('data.scan_state', 'revoked')
            ->assertJsonPath('data.revoked_reason', 'moderation')
            ->assertJsonPath('data.downloads', null);

        foreach (['svg', 'png', 'pdf'] as $format) {
            $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr.'.$format)->assertNotFound();
        }
    });
});

describe('rendering', function () {
    it('encodes the uppercase URL, which fits alphanumeric mode with fewer modules', function () {
        config(['app.url' => 'https://speedclub.de']);
        $payload = app(QrCodes::class)->payload($this->qr);

        expect($payload)->toBe('HTTPS://SPEEDCLUB.DE/C/'.$this->qr->code)
            ->and(AlphaNum::validateString($payload))->toBeTrue()
            ->and(AlphaNum::validateString(strtolower($payload)))->toBeFalse();
    });

    it('keeps a path of APP_URL as it is, because a path is case-sensitive', function () {
        config(['app.url' => 'https://speedclub.de/staging']);

        expect(app(QrCodes::class)->payload($this->qr))->toBe('HTTPS://SPEEDCLUB.DE/staging/C/'.$this->qr->code);
    });

    it('generates codes from the Crockford alphabet', function () {
        expect($this->qr->code)->toHaveLength(8)
            ->and(Codes::isValid($this->qr->code))->toBeTrue();
    });

    it('serves a PNG of the asked size that really decodes to the code, black on white, level Q', function () {
        Sanctum::actingAs($this->owner);

        $response = $this->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.png')->assertOk();

        expect($response->headers->get('Content-Type'))->toBe('image/png')
            ->and($response->headers->get('Content-Disposition'))->toContain('speedclub-qr-'.$this->qr->code.'.png')
            ->and($response->headers->get('Cache-Control'))->toContain('no-store');

        $png = $response->getContent();
        [$width, $height, $type] = getimagesizefromstring($png);

        expect([$width, $height, $type])->toBe([1024, 1024, IMAGETYPE_PNG]);

        $result = (new Library(new QROptions))->readFromBlob($png);

        expect($result->data)->toBe(app(QrCodes::class)->payload($this->qr))
            ->and($result->eccLevel->getLevel())->toBe(EccLevel::Q);

        $image = imagecreatefromstring($png);
        $colors = [];

        for ($x = 0; $x < 1024; $x += 3) {
            for ($y = 0; $y < 1024; $y += 37) {
                $colors[imagecolorat($image, $x, $y)] = true;
            }
        }

        expect(array_keys($colors))->toEqualCanonicalizing([0x000000, 0xFFFFFF])
            ->and(imagecolorat($image, 0, 0))->toBe(0xFFFFFF);
    });

    it('leaves at least four white modules around the code', function () {
        $payload = app(QrCodes::class)->payload($this->qr);
        $png = app(QrRenderer::class)->png($payload, 1024);
        $image = imagecreatefromstring($png);

        $matrix = (new Library(new QROptions(['eccLevel' => EccLevel::Q, 'addQuietzone' => false])))
            ->addAlphaNumSegment($payload)->getQRMatrix();
        $moduleSize = (int) floor(1024 / ($matrix->getSize() + 8));

        for ($offset = 0; $offset < 1024; $offset += 7) {
            expect(imagecolorat($image, $offset, 4 * $moduleSize - 1))->toBe(0xFFFFFF)
                ->and(imagecolorat($image, 4 * $moduleSize - 1, $offset))->toBe(0xFFFFFF);
        }
    });

    it('serves 2048 on request and refuses other sizes', function () {
        Sanctum::actingAs($this->owner);

        $png = $this->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.png?size=2048')->assertOk()->getContent();

        expect(array_slice(getimagesizefromstring($png), 0, 2))->toBe([2048, 2048]);

        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr.png?size=4096')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('size');
    });

    it('serves an SVG with the modules of the same matrix, black on white, and nothing active in it', function () {
        Sanctum::actingAs($this->owner);

        $response = $this->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.svg')->assertOk();
        $svg = $response->getContent();

        expect($response->headers->get('Content-Type'))->toBe('image/svg+xml')
            ->and($response->headers->get('Content-Disposition'))->toStartWith('attachment');

        $document = new DOMDocument;
        expect($document->loadXML($svg))->toBeTrue();

        $root = $document->documentElement;
        $matrix = (new Library(new QROptions(['eccLevel' => EccLevel::Q, 'addQuietzone' => true, 'quietzoneSize' => 4])))
            ->addAlphaNumSegment(app(QrCodes::class)->payload($this->qr))->getQRMatrix();
        $fills = [];

        foreach ($document->getElementsByTagName('path') as $path) {
            $fills[$path->getAttribute('fill')] = true;
        }

        expect($root->nodeName)->toBe('svg')
            ->and($root->getAttribute('viewBox'))->toBe('0 0 '.$matrix->getSize().' '.$matrix->getSize())
            ->and(array_keys($fills))->toEqualCanonicalizing(['#000', '#fff'])
            ->and($document->getElementsByTagName('script')->length)->toBe(0)
            ->and($document->getElementsByTagName('image')->length)->toBe(0);
    });

    it('has no logo space in the matrix', function () {
        $matrix = (new Library(new QROptions(['eccLevel' => EccLevel::Q])))
            ->addAlphaNumSegment(app(QrCodes::class)->payload($this->qr))->getQRMatrix();

        expect($matrix->checkTypeIn(10, 10, [QRMatrix::M_LOGO, QRMatrix::M_LOGO_DARK]))->toBeFalse();
    });

    it('serves a valid one-page A6 PDF with its fonts embedded', function (string $locale) {
        Sanctum::actingAs($this->owner);

        $response = $this->withHeader('Accept-Language', $locale)->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.pdf')->assertOk();
        $pdf = $response->getContent();

        expect($response->headers->get('Content-Type'))->toBe('application/pdf')
            ->and(substr($pdf, 0, 5))->toBe('%PDF-')
            ->and(rtrim($pdf))->toEndWith('%%EOF')
            ->and(preg_match_all('~/Type\s*/Page\b(?!s)~', $pdf))->toBe(1);

        preg_match('~/MediaBox\s*\[\s*0\.000 0\.000 ([\d.]+) ([\d.]+)\s*\]~', $pdf, $box);

        // A6 is 105 × 148 mm.
        expect(round((float) $box[1] / 72 * 25.4))->toBe(105.0)
            ->and(round((float) $box[2] / 72 * 25.4))->toBe(148.0)
            ->and($pdf)->toContain('Inter-Regular')
            ->and($pdf)->toContain('BarlowSemiCondensed-Bold')
            ->and(substr_count($pdf, '/FontFile2'))->toBe(3);
    })->with(['de', 'en']);

    it('puts the logo beside the code, with the username, the short code and a placement hint', function () {
        $data = app(QrSticker::class)->viewData($this->qr);
        $html = view('pdf.qr-sticker', $data)->render();
        $spaced = substr($this->qr->code, 0, 4).' '.substr($this->qr->code, 4);

        expect($html)->toContain('@lukas.sc')
            ->and($html)->toContain($spaced)
            ->and($html)->toContain('Kofferraumdeckel')
            ->and($html)->toContain('Keine Rechtsberatung')
            ->and($data['logo'])->toBeFile();

        $png = base64_decode(substr($data['qr_image'], strlen('data:image/png;base64,')));

        expect(array_slice(getimagesizefromstring($png), 0, 2))->toBe([2048, 2048]);
    });

    it('prints the placement guidance and footer of 08_LEGAL §7 word for word', function (string $locale, array $sentences) {
        app()->setLocale($locale);
        $html = view('pdf.qr-sticker', app(QrSticker::class)->viewData($this->qr))->render();

        foreach ($sentences as $sentence) {
            expect($html)->toContain(e($sentence));
        }
    })->with([
        'de' => ['de', [
            'Am sichersten: außen auf der Karosserie (z. B. Kofferraumdeckel, Stoßfänger) oder klein innen in einer Ecke der Heckscheibe.',
            'Heckscheibe nur, wenn dein Auto zwei Außenspiegel hat. Sonst nur ganz am Rand, damit die Sicht nach hinten frei bleibt.',
            'Nicht spiegelnd, nicht leuchtend, keine Kennzeichen, Leuchten oder Plaketten verdecken.',
            'Druck: mindestens 30 × 30 mm für Scans aus etwa 1 m, für größere Entfernungen größer. Rund um den Code einen weißen Rand von 4 Modulen (Kästchen) frei lassen. Matte Folie, schwarz auf weiß.',
            'Keine Rechtsberatung. Maßgeblich sind die StVZO (u. a. §§ 35b, 40) und die Auslegung der Behörden. Verstöße können ein Bußgeld nach sich ziehen.',
        ]],
        'en' => ['en', [
            'Safest: outside on the bodywork (e.g. boot lid, bumper) or small, inside a corner of the rear window.',
            'Rear window only if your car has two exterior mirrors. Otherwise only right at the edge, so the view to the rear stays clear.',
            'Not reflective, not illuminated, never covering number plates, lights or inspection stickers.',
            'Printing: at least 30 × 30 mm for scans from about 1 m, larger for longer distances. Leave a white margin of 4 modules (squares) around the code. Matte vinyl, black on white.',
            'Not legal advice. The German StVZO (including §§ 35b, 40) and how the authorities apply it are decisive. Violations can result in a fine.',
        ]],
    ]);

    it('keeps the full guidance on one A6 page, also under the longest username', function (string $locale) {
        $this->owner->forceFill(['username' => str_repeat('m', config()->integer('speedclub.usernames.max_length'))])->save();
        Sanctum::actingAs($this->owner);

        $pdf = $this->withHeader('Accept-Language', $locale)->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.pdf')->assertOk()->getContent();

        expect(preg_match_all('~/Type\s*/Page\b(?!s)~', $pdf))->toBe(1);
    })->with(['de', 'en']);

    it('leaves the @username off the sticker when the owner asked not to be named on the page it leads to', function () {
        $this->owner->forceFill(['show_owner_on_qr' => false])->save();

        $data = app(QrSticker::class)->viewData($this->qr->fresh());
        $html = view('pdf.qr-sticker', $data)->render();

        expect($data['username'])->toBeNull()
            ->and($html)->not->toContain('lukas.sc')
            ->and($html)->toContain(substr($this->qr->code, 0, 4).' '.substr($this->qr->code, 4));

        Sanctum::actingAs($this->owner);

        $pdf = $this->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.pdf')->assertOk()->getContent();

        expect(preg_match_all('~/Type\s*/Page\b(?!s)~', $pdf))->toBe(1);
    });

    it('works through a cookie session as well as a bearer token', function (string $format) {
        $token = $this->owner->createToken('phone', ['member'])->plainTextToken;

        $this->withHeader('Authorization', 'Bearer '.$token)
            ->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.'.$format)
            ->assertOk();

        app('auth')->forgetGuards();
        $this->flushHeaders();

        $session = databaseSessionFor($this->owner, 'web');

        $this->withCookie(config()->string('session.cookie'), $session)
            ->withHeaders(['Referer' => 'http://localhost:8080/app/qr/x'])
            ->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.'.$format)
            ->assertOk();
    })->with(['svg', 'png', 'pdf']);

    it('limits downloads', function () {
        config(['speedclub.rate_limits.qr_downloads.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);

        $this->get('/api/v1/vehicles/'.$this->vehicle->id.'/qr.svg')->assertOk();
        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr.svg')
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');
    });
});

describe('POST vehicles/{id}/qr/reissue', function () {
    it('revokes the old code with its reason, makes a new one and writes the audit log', function () {
        Sanctum::actingAs($this->owner);
        $old = $this->qr->code;

        $response = $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk()
            ->assertJsonPath('data.status', 'active');

        $new = $response->json('data.code');
        $revoked = QrCode::query()->where('code', $old)->firstOrFail();

        expect($new)->not->toBe($old)
            ->and($revoked->status)->toBe(QrStatus::Revoked)
            ->and($revoked->getAttribute('revoked_reason'))->toBe(QrRevocationReason::Reissued)
            ->and($revoked->getAttribute('revoked_at'))->not->toBeNull()
            ->and($this->vehicle->qrCodes()->where('status', QrStatus::Active)->count())->toBe(1);

        $event = AuditEvent::query()->where('action', MemberSecurityEvent::QrReissued->value)->firstOrFail();

        expect($event->getAttribute('target_id'))->toBe($this->vehicle->id)
            ->and($event->getAttribute('actor_id'))->toBe($this->owner->id)
            ->and($event->getAttribute('before'))->toBe(['code' => $old])
            ->and($event->getAttribute('after'))->toBe(['code' => $new])
            ->and($event->getAttribute('reason'))->toBe('reissued');

        $this->getJson('/api/v1/qr/'.$old)->assertJsonPath('data.state', 'revoked');
        $this->getJson('/api/v1/qr/'.$new)->assertJsonPath('data.state', 'active');
    });

    it('replays with the same Idempotency-Key instead of killing the next sticker', function () {
        Sanctum::actingAs($this->owner);

        $first = $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue', [], ['Idempotency-Key' => 'reissue-1'])->assertOk();
        $again = $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue', [], ['Idempotency-Key' => 'reissue-1'])->assertOk();

        expect($again->json('data.code'))->toBe($first->json('data.code'))
            ->and($this->vehicle->qrCodes()->count())->toBe(2);
    });

    it('is rate limited', function () {
        config(['speedclub.rate_limits.qr_reissues.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk();
        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited');
    });

    it('does not let the owner undo a staff takedown, until staff issue a new code', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Moderation);
        Sanctum::actingAs($this->owner);

        $this->withHeader('Accept-Language', 'de')->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')
            ->assertForbidden()
            ->assertJsonPath('code', 'qr_revoked_by_staff')
            ->assertJsonPath('message', "Das SPEED-CLUB-Team hat diesen QR-\u{2060}Code gesperrt. Einen neuen bekommst du über den Support.");

        expect($this->vehicle->qrCodes()->where('status', QrStatus::Active)->exists())->toBeFalse();
        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr.svg')->assertNotFound();
        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertJsonPath('data.state', 'revoked');

        // Staff reissue (ADM-19) gives the vehicle an active code again, and with it the owner's own button.
        app(QrCodes::class)->ensureActive($this->vehicle);

        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk()->assertJsonPath('data.status', 'active');
    });

    it('still lets the owner replace a code after a replacement of their own', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk();
        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk();

        expect($this->vehicle->qrCodes()->count())->toBe(3);
    });

    it('refuses a draft and a deleted vehicle', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles/'.$draft->id.'/qr/reissue')->assertForbidden();

        $this->vehicle->delete();
        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertNotFound();
    });
});

describe('GET vehicles/{id}/qr/stats', function () {
    it('does not exist while the flag is off', function () {
        Sanctum::actingAs($this->owner);

        // ADR-189 c: a route whose sig.* flag is off is 404 feature_disabled, before anything about the vehicle.
        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/stats')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/stats')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('gives 14 days oldest first with the empty ones, and a total over all codes of the vehicle', function () {
        FeatureFlag::query()->create(['key' => 'sig.qr_stats', 'enabled' => true]);
        $this->travelTo('2026-11-03 12:00:00');

        $old = QrCode::factory()->revoked()->create(['vehicle_id' => $this->vehicle->id]);
        QrScanDaily::factory()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-11-03', 'count' => 5]);
        QrScanDaily::factory()->create(['qr_code_id' => $old->id, 'day' => '2026-11-03', 'count' => 2]);
        QrScanDaily::factory()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-10-21', 'count' => 1]);
        QrScanDaily::factory()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-10-20', 'count' => 100]);
        $other = app(QrCodes::class)->ensureActive(publishedVehicle());
        QrScanDaily::factory()->create(['qr_code_id' => $other->id, 'day' => '2026-11-03', 'count' => 50]);

        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/stats')->assertOk()
            ->assertJsonCount(14, 'data.days')
            ->assertJsonPath('data.days.0', ['date' => '2026-10-21', 'count' => 1])
            ->assertJsonPath('data.days.1', ['date' => '2026-10-22', 'count' => 0])
            ->assertJsonPath('data.days.13', ['date' => '2026-11-03', 'count' => 7])
            ->assertJsonPath('data.total_14_days', 8)
            ->assertJsonPath('data.total', 108);
    });
});

describe('GET qr/{code}', function () {
    it('leads an active code to the canonical slug', function () {
        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertOk()
            ->assertJsonPath('data.state', 'active')
            ->assertJsonPath('data.slug', $this->vehicle->canonicalSlug())
            ->assertJsonPath('data.title', null);
    });

    it('takes lower case and the Crockford read-alikes', function () {
        $qr = QrCode::factory()->create(['vehicle_id' => publishedVehicle()->id, 'code' => '01ABCDEF']);

        $this->getJson('/api/v1/qr/o1abcdef')->assertJsonPath('data.state', 'active');
        $this->getJson('/api/v1/qr/'.$qr->code)->assertJsonPath('data.state', 'active');
    });

    it('shows nothing of the vehicle for revoked, private and unknown codes', function (Closure $arrange, string $state, string $title) {
        $code = $arrange($this->vehicle, $this->qr);

        $response = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/qr/'.$code)->assertOk()
            ->assertJsonPath('data.state', $state)
            ->assertJsonPath('data.slug', null)
            ->assertJsonPath('data.title', $title);

        expect($response->getContent())->not->toContain($this->vehicle->public_id)
            ->and(array_keys($response->json('data')))->toBe(['state', 'slug', 'title', 'message']);
    })->with([
        'revoked' => [function (Vehicle $vehicle, QrCode $qr) {
            app(QrCodes::class)->revoke($vehicle, QrRevocationReason::Reissued);

            return $qr->code;
        }, 'revoked', "Dieser QR-\u{2060}Code ist nicht mehr gültig"],
        'deleted vehicle' => [function (Vehicle $vehicle, QrCode $qr) {
            app(QrCodes::class)->revoke($vehicle, QrRevocationReason::VehicleDeleted);
            $vehicle->delete();

            return $qr->code;
        }, 'revoked', 'Dieses Fahrzeug ist nicht mehr verfügbar'],
        'staff takedown' => [function (Vehicle $vehicle, QrCode $qr) {
            app(QrCodes::class)->revoke($vehicle, QrRevocationReason::Moderation);

            return $qr->code;
        }, 'revoked', "Dieser QR-\u{2060}Code ist nicht mehr gültig"],
        'private' => [function (Vehicle $vehicle, QrCode $qr) {
            $vehicle->forceFill(['visibility' => 'private'])->save();

            return $qr->code;
        }, 'private', 'Dieses Fahrzeug ist privat'],
        'suspended owner reads as private' => [function (Vehicle $vehicle, QrCode $qr) {
            $vehicle->owner->forceFill(['status' => 'suspended'])->save();

            return $qr->code;
        }, 'private', 'Dieses Fahrzeug ist privat'],
        'unknown' => [fn () => '00000000', 'not_found', "Diesen QR-\u{2060}Code kennen wir nicht"],
        'not a code at all' => [fn () => 'nonsense-code', 'not_found', "Diesen QR-\u{2060}Code kennen wir nicht"],
    ]);

    it('shows an owner their own private vehicle, but never a revoked code', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertJsonPath('data.state', 'active');

        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);

        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertJsonPath('data.state', 'revoked')->assertJsonPath('data.slug', null);
    });

    it('reads as private across a block', function () {
        $blocked = User::factory()->create();
        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $blocked->id]);
        Sanctum::actingAs($blocked);

        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertJsonPath('data.state', 'private')->assertJsonPath('data.slug', null);
    });

    it('speaks English', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);

        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/qr/'.$this->qr->code)
            ->assertJsonPath('data.title', 'This QR code is no longer valid');
    });

    it('gives a revoked code no reason, and says unavailable only when the vehicle or the account is gone', function (QrRevocationReason $reason, bool $deleteVehicle, string $locale, string $title, string $message) {
        app(QrCodes::class)->revoke($this->vehicle, $reason);

        if ($deleteVehicle) {
            $this->vehicle->delete();
        }

        $response = $this->withHeader('Accept-Language', $locale)->getJson('/api/v1/qr/'.$this->qr->code)->assertOk()
            ->assertJsonPath('data.state', 'revoked')
            ->assertJsonPath('data.title', $title)
            ->assertJsonPath('data.message', $message);

        expect($response->getContent())->not->toContain('Besitzer')->not->toContain('owner');
    })->with(qrRevokedCopy());

    it('keeps the code of a sold car "no longer valid" when the seller deletes the vehicle later', function () {
        $old = $this->qr->code;
        app(ReissueQrCode::class)->handle($this->owner, $this->vehicle);
        app(DeleteVehicle::class)->handle($this->owner, $this->vehicle->fresh());

        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/qr/'.$old)
            ->assertJsonPath('data.title', "Dieser QR-\u{2060}Code ist nicht mehr gültig");
    });

    it('keeps a tombstone of the code after the hard delete, which still reads unavailable and is never handed out again', function () {
        app(DeleteVehicle::class)->handle($this->owner, $this->vehicle);
        Vehicle::withTrashed()->whereKey($this->vehicle->id)->update(['deleted_at' => now()->subDays(31)]);

        $this->artisan('vehicles:prune')->assertSuccessful();

        $tombstone = QrCode::query()->where('code', $this->qr->code)->firstOrFail();

        expect(Vehicle::withTrashed()->find($this->vehicle->id))->toBeNull()
            ->and($tombstone->getAttribute('vehicle_id'))->toBeNull()
            ->and($tombstone->status)->toBe(QrStatus::Revoked)
            ->and($tombstone->getAttribute('revoked_reason'))->toBe(QrRevocationReason::VehicleDeleted);

        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/qr/'.$this->qr->code)
            ->assertJsonPath('data.state', 'revoked')
            ->assertJsonPath('data.title', 'Dieses Fahrzeug ist nicht mehr verfügbar');

        expect(fn () => QrCode::factory()->create(['vehicle_id' => publishedVehicle()->id, 'code' => $this->qr->code]))
            ->toThrow(UniqueConstraintViolationException::class);
    });

    it('revokes a code the hard delete finds still active, as a vehicle can be gone without DeleteVehicle', function () {
        $this->vehicle->delete();
        Vehicle::withTrashed()->whereKey($this->vehicle->id)->update(['deleted_at' => now()->subDays(31)]);

        $this->artisan('vehicles:prune')->assertSuccessful();

        $tombstone = QrCode::query()->where('code', $this->qr->code)->firstOrFail();

        expect($tombstone->status)->toBe(QrStatus::Revoked)
            ->and($tombstone->getAttribute('revoked_reason'))->toBe(QrRevocationReason::VehicleDeleted);
    });

    it('allows 120 requests per minute from an address, shared with the web resolver', function () {
        expect(config()->integer('speedclub.rate_limits.qr.max'))->toBe(120)
            ->and(config()->integer('speedclub.rate_limits.qr.minutes'))->toBe(1)
            ->and(Route::getRoutes()->getByName('api.v1.qr.resolve')->middleware())->toContain('throttle:qr');

        config(['speedclub.rate_limits.qr.max' => 1]);
        RateLimits::register();

        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertOk();
        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('scan counting', function () {
    function scansOf(QrCode $qr): int
    {
        return (int) QrScanDaily::query()->where('qr_code_id', $qr->id)->sum('count');
    }

    it('adds up per day in one row, from the app and from the web', function () {
        $this->travelTo('2026-11-03 12:00:00');

        $this->withHeader('User-Agent', QR_BROWSER)->getJson('/api/v1/qr/'.$this->qr->code)->assertOk();
        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code)->assertRedirect();
        $this->withHeader('User-Agent', QR_BROWSER)->get('/c/'.$this->qr->code)->assertRedirect();

        expect(QrScanDaily::query()->where('qr_code_id', $this->qr->id)->count())->toBe(1)
            ->and(scansOf($this->qr))->toBe(3);

        $this->travelTo('2026-11-04 12:00:00');
        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code);

        expect(QrScanDaily::query()->where('qr_code_id', $this->qr->id)->count())->toBe(2)
            ->and(scansOf($this->qr))->toBe(4);
    });

    it('stores a number and a day, nothing else', function () {
        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code);

        $row = (array) DB::table('qr_scan_daily')->first();

        expect(array_keys($row))->toEqualCanonicalizing(['id', 'qr_code_id', 'day', 'count'])
            ->and($row['count'])->toBe(1);
    });

    it('counts by the German day', function () {
        $this->travelTo('2026-11-03 23:30:00');

        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code);

        expect(QrScanDaily::query()->where('qr_code_id', $this->qr->id)->firstOrFail()->getRawOriginal('day'))->toBe('2026-11-04');
    });

    it('leaves out known bots, previews and link fetches', function (?string $agent) {
        $request = $agent === null ? $this->withHeaders(['User-Agent' => '']) : $this->withHeader('User-Agent', $agent);

        $request->get('/C/'.$this->qr->code)->assertRedirect();

        expect(scansOf($this->qr))->toBe(0);
    })->with([
        'Googlebot' => 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Bingbot' => 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        'Facebook' => 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'WhatsApp' => 'WhatsApp/2.23.20.0 A',
        'Telegram' => 'TelegramBot (like TwitterBot)',
        'Snapchat preview' => 'Mozilla/5.0 (compatible; Snap URL Preview Service; bot; snapchat_proxy)',
        'LinkedIn preview' => 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
        'curl' => 'curl/8.5.0',
        'Lighthouse' => 'Mozilla/5.0 (Linux; Android 11; moto g power) Chrome/120 Safari/537.36 Chrome-Lighthouse',
        'empty' => null,
    ]);

    it('counts a scan that opens in the browser of another app, as the camera of Snapchat does', function (string $agent) {
        $this->travelTo('2026-11-03 12:00:00');

        $this->withHeader('User-Agent', $agent)->get('/C/'.$this->qr->code)->assertRedirect('/v/'.$this->vehicle->canonicalSlug());

        expect(scansOf($this->qr))->toBe(1)
            ->and(QrScanDaily::query()->where('qr_code_id', $this->qr->id)->firstOrFail()->getRawOriginal('day'))->toBe('2026-11-03');
    })->with([
        'Snapchat on iPhone' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.55.0.36 (like Safari/8618.2.12.10.6, panda)',
        'Snapchat on Android' => 'Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36Snapchat/12.90.0.46 (like Chrome/125.0.6422.165)',
        'LinkedIn' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6',
        'Pinterest' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
        'Instagram' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,3; iOS 17_5; de_DE; de; scale=3.00; 1290x2796; 615432343)',
    ]);

    it('leaves out a browser prefetch', function () {
        $this->withHeaders(['User-Agent' => QR_BROWSER, 'Sec-Purpose' => 'prefetch'])->get('/C/'.$this->qr->code);

        expect(scansOf($this->qr))->toBe(0);
    });

    it('leaves out the owner in the app', function () {
        Sanctum::actingAs($this->owner);

        $this->withHeader('User-Agent', QR_BROWSER)->getJson('/api/v1/qr/'.$this->qr->code)->assertOk();

        expect(scansOf($this->qr))->toBe(0);
    });

    it('leaves out the owner in a signed-in browser, and counts another member', function () {
        $session = databaseSessionFor($this->owner, 'web');
        $this->withCookie(config()->string('session.cookie'), $session)
            ->withHeader('User-Agent', QR_BROWSER)
            ->get('/C/'.$this->qr->code)
            ->assertRedirect();

        expect(scansOf($this->qr))->toBe(0);

        $this->flushHeaders();
        // The handler remembers that it has seen a row, so a second session in one test needs a new one.
        app('session')->forgetDrivers();
        $other = databaseSessionFor(User::factory()->create(), 'web');
        $this->withCookie(config()->string('session.cookie'), $other)
            ->withHeader('User-Agent', QR_BROWSER)
            ->get('/C/'.$this->qr->code)
            ->assertRedirect();

        expect(scansOf($this->qr))->toBe(1);
    });

    it('does not count a revoked or unknown code, but counts a private one, which is still the sticker', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();
        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code);

        expect(scansOf($this->qr))->toBe(1);

        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);
        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code);
        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/00000000');

        expect(scansOf($this->qr))->toBe(1)
            ->and(QrScanDaily::query()->count())->toBe(1);
    });

    it('never breaks the redirect or the app when counting fails', function () {
        Exceptions::fake();

        $this->app->bind(QrScans::class, fn () => new class extends QrScans
        {
            protected function increment(QrCode $qr): void
            {
                throw new RuntimeException('The counter is down.');
            }
        });

        $this->withHeader('User-Agent', QR_BROWSER)->get('/C/'.$this->qr->code)->assertRedirect('/v/'.$this->vehicle->canonicalSlug());
        $this->withHeader('User-Agent', QR_BROWSER)->getJson('/api/v1/qr/'.$this->qr->code)->assertOk()->assertJsonPath('data.state', 'active');

        Exceptions::assertReported(RuntimeException::class);
    });

    it('reports through record only for what QrResolution says', function () {
        $request = Request::create('/C/x', 'GET', server: ['HTTP_USER_AGENT' => QR_BROWSER]);

        app(QrScans::class)->record(new QrResolution(QrScanState::NotFound), $request, null);

        expect(QrScanDaily::query()->count())->toBe(0);
    });
});
