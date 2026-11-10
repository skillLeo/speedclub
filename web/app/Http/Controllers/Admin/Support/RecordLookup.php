<?php

namespace App\Http\Controllers\Admin\Support;

use App\Models\QrCode;
use App\Models\User;

/**
 * Record pages take the ULID (what every admin link uses) and, for a person pasting from elsewhere, the natural key: a member by
 * username (ADM-10), a QR code by the code printed on the sticker (ADM-19). A ULID has 26 characters, a username at most 24 and a code
 * 8, so the two never collide. Unknown → 404.
 */
final class RecordLookup
{
    /** Route pattern of {member}: a ULID or a username. */
    public const MEMBER = '[0-9A-Za-z._]{1,26}';

    /** Route pattern of {qr}: a ULID or an 8-character code. */
    public const QR = '[0-9A-Za-z]{8}|[0-9A-Za-z]{26}';

    public static function member(string $key): User
    {
        $query = User::withTrashed();
        $member = strlen($key) === 26 ? $query->find(strtolower($key)) : $query->where('username', strtolower(ltrim($key, '@')))->first();

        abort_unless($member instanceof User, 404);

        return $member;
    }

    public static function qr(string $key): QrCode
    {
        $qr = strlen($key) === 26 ? QrCode::query()->find(strtolower($key)) : QrCode::query()->where('code', strtoupper($key))->first();

        abort_unless($qr instanceof QrCode, 404);

        return $qr;
    }
}
