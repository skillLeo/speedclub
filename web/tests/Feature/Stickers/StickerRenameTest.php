<?php

use App\Enums\NotificationType;
use App\Http\Controllers\Web\SpaController;
use App\Models\Notification;
use App\Services\Notifications\NotificationTexts;
use Illuminate\Support\Arr;

require_once __DIR__.'/StickerTestHelpers.php';

/**
 * 10 §2.1 / ADR-504: "Sticker" replaces "QR-Code" as the product name in every server text; "QR-Code" remains only as a part of a
 * sticker. The scan address /c/{code} never moves; the member-web QR screens move to /app/stickers for good.
 */
it('maps the old member-web QR addresses to the sticker screens', function (string $from, string $to) {
    expect(SpaController::movedPath($from))->toBe($to);
})->with([
    'hub' => ['profile/qr', 'stickers'],
    'detail' => ['qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ', 'stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ'],
    'placement' => ['qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ/placement', 'stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ/placement'],
    'preview' => ['qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ/preview', 'stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ/preview'],
]);

it('moves the old member-web QR addresses to the sticker screens for good, with their query', function (string $from, string $to) {
    $this->get($from)->assertStatus(301)->assertRedirect($to);
})->with([
    'hub' => ['/app/profile/qr', '/app/stickers'],
    'detail' => ['/app/qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ', '/app/stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ'],
    'placement' => ['/app/qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ/placement', '/app/stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ/placement'],
    'preview with query' => ['/app/qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ/preview?utm_source=push', '/app/stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ/preview?utm_source=push'],
]);

it('serves the sticker screens and every other member-web address without a redirect', function (string $path) {
    $response = $this->get($path)->baseResponse;

    // The SPA index (200), or the "not exported" page where no export exists (404): never a redirect.
    expect($response->getStatusCode())->toBeIn([200, 404])
        ->and($response->headers->get('Location'))->toBeNull();
})->with(['/app/stickers', '/app/stickers/01JD5Z2K4QXMB7H2KQXMB7H2KQ', '/app/qr/not-a-ulid', '/app/profile']);

it('leaves every other member-web address and the scan address alone', function () {
    expect(SpaController::movedPath('qr/not-a-ulid'))->toBeNull()
        ->and(SpaController::movedPath('stickers'))->toBeNull()
        ->and(SpaController::movedPath('profile'))->toBeNull()
        ->and(SpaController::movedPath('qr/01JD5Z2K4QXMB7H2KQXMB7H2KQ/other'))->toBeNull();

    [$vehicle, $qr] = stkCar();
    $this->get('/c/'.$qr->code)->assertRedirect('/v/'.$vehicle->canonicalSlug());
});

it('opens the scan milestone on the car\'s sticker detail', function () {
    [$vehicle] = stkCar();
    $row = new Notification;
    $row->forceFill(['type' => NotificationType::QrMilestone, 'data' => ['milestone' => 10]]);
    $row->setRelation('vehicle', $vehicle);

    expect(app(NotificationTexts::class)->path($row))->toBe('/stickers/'.$vehicle->id);
});

it('says Sticker, not QR-Code, in every server text except where the code is a part of the sticker', function (string $locale) {
    $allowed = [
        // The QR image next to text, the code as a part of a sticker, the authenticator code of staff.
        'public.home.qr_label', 'public.get_app.qr_alt', 'public.home.thought_body', 'stickers.', 'errors.sticker_', 'enums.sticker_scan_test.not_applicable',
    ];
    $hits = [];

    foreach (glob(lang_path($locale.'/*.php')) ?: [] as $file) {
        $group = basename($file, '.php');

        foreach (Arr::dot(require $file) as $key => $text) {
            $full = $group.'.'.$key;

            if (is_string($text) && preg_match('/\bQR\b/u', str_replace("\u{2060}", '', $text)) === 1 && collect($allowed)->every(fn (string $a): bool => ! str_starts_with($full, $a))) {
                $hits[] = $full;
            }
        }
    }

    expect($hits)->toBe([]);
})->with(['de', 'en']);
