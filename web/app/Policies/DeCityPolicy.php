<?php

namespace App\Policies;

/**
 * M5.9b: public reference geography (GeoNames), read by everyone; no member writes.
 */
class DeCityPolicy extends PublicReadPolicy {}
