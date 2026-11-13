<?php

namespace App\Http\Controllers\Api\V1\Diagnostics;

use App\Actions\Diagnostics\RecordClientError;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Diagnostics\ClientErrorRequest;
use App\Support\Viewer;
use Illuminate\Http\Response;

/**
 * POST /api/v1/client-errors: a crash report of the app's error screen. Always 204, so a report never adds a second failure.
 */
class ClientErrorController extends Controller
{
    public function __invoke(ClientErrorRequest $request, RecordClientError $record): Response
    {
        $record->handle($request->validated(), Viewer::from($request));

        return response()->noContent();
    }
}
