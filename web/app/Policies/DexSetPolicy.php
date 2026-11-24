<?php

namespace App\Policies;

/**
 * M5.9b: the STREET DEX sets are public rules, read by everyone; members never write them (seeded, later staff-managed).
 */
class DexSetPolicy extends PublicReadPolicy {}
