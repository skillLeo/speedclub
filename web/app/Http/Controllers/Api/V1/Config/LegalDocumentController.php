<?php

namespace App\Http\Controllers\Api\V1\Config;

use App\Enums\ErrorCode;
use App\Enums\LegalDocumentKey;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Config\ShowLegalDocumentRequest;
use App\Http\Resources\V1\LegalDocumentResource;
use App\Http\Resources\V1\LegalDocumentSummaryResource;
use App\Services\AppConfig\LegalDocuments;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class LegalDocumentController extends Controller
{
    /**
     * The legal documents for the list screen.
     *
     * Newest published version of each document in the language of Accept-Language, German if there is no translation.
     * The title always follows the language of the request.
     *
     * @unauthenticated
     */
    public function index(LegalDocuments $documents): AnonymousResourceCollection
    {
        return LegalDocumentSummaryResource::collection($documents->all(app()->getLocale()));
    }

    /**
     * A published legal document.
     *
     * The newest version in the language of Accept-Language, German if there is no translation. `version` asks for
     * an older one. The body is Markdown.
     *
     * @unauthenticated
     */
    public function show(ShowLegalDocumentRequest $request, LegalDocumentKey $key, LegalDocuments $documents): LegalDocumentResource
    {
        /** @var string|null $version */
        $version = $request->validated('version');
        $document = $documents->current($key, app()->getLocale(), $version);

        if ($document === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('view', $document);

        return new LegalDocumentResource($document);
    }
}
