<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Support\DevMail\DevMailbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Local mail preview (docs/DEPLOY.md §10). The routes exist only in the preview environments. The Playwright flow F1 reads
 * verification codes from latest().
 */
class DevMailController extends Controller
{
    public function index(DevMailbox $mailbox): JsonResponse
    {
        return response()->json(['data' => array_map(
            fn (array $mail): array => ['at' => $mail['at'], 'to' => $mail['to'], 'subject' => $mail['subject'], 'code' => $mail['code']],
            $mailbox->recent(),
        )]);
    }

    public function latest(Request $request, DevMailbox $mailbox): JsonResponse
    {
        $to = $request->query('to');
        $mail = is_string($to) ? $mailbox->latestTo($to) : null;

        return $mail === null
            ? response()->json(['message' => 'No mail for this address.'], 404)
            : response()->json($mail);
    }
}
