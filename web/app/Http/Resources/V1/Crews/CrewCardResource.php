<?php

namespace App\Http\Resources\V1\Crews;

use App\Models\Crew;

/**
 * A crew in a list (CREW-00, invitations and requests; contract-crews.md §2 CrewCard). member_count is a fact on the card, never an
 * order (C2). `viewer` is the reader's role and state, null for guests.
 *
 * @property Crew $resource
 */
class CrewCardResource extends CrewCardBase {}
