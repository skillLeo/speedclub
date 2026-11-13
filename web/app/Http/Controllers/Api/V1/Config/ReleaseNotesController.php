<?php

namespace App\Http\Controllers\Api\V1\Config;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\ReleaseNoteResource;
use App\Services\AppConfig\ReleaseNotes;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ReleaseNotesController extends Controller
{
    /**
     * What is new.
     *
     * SET-25 "Was ist neu": the releases members got, newest first, in the language of Accept-Language (German when a release has no
     * text in it). Guests too; cache with the ETag.
     *
     * @unauthenticated
     */
    public function index(ReleaseNotes $notes): AnonymousResourceCollection
    {
        return ReleaseNoteResource::collection($notes->all(app()->getLocale()));
    }
}
