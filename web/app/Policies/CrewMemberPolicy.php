<?php

namespace App\Policies;

/**
 * No ability of its own: rows of this model are read and written through CrewPolicy (the crew) and the crew Actions of R4-2.3 only.
 */
class CrewMemberPolicy {}
