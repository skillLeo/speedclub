<?php

namespace App\Policies;

/**
 * M4.11: internal rows; entries are read and changed through MemberCollectionPolicy. No member ability, so every check is denied.
 */
class MemberCollectionItemPolicy {}
