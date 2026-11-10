<?php

namespace App\Http\Requests\Api\V1\Messaging;

/**
 * Shared rules of the messaging requests.
 */
final class MessagingRules
{
    /** The client's id of a message: a UUID from the app, or any 8–64 letters, digits and dashes. */
    public const CLIENT_ID = 'regex:/\A[A-Za-z0-9-]{8,64}\z/';

    /** A ULID, as every id of this API. */
    public const ULID = 'regex:/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/';
}
