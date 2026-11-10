<?php

namespace App\Policies;

/**
 * Kollektionen of DISC-01: everybody reads them, nobody but the Phase 3 admin writes them (ADM-29, staff guard).
 */
class DiscoverCollectionPolicy extends PublicReadPolicy {}
