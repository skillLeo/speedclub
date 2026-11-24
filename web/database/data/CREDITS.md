# Data credits

- `de_cities.csv` and `web/public/geo/de-cities.json` (STREET DEX cities, M5.9b, ADR-508): **GeoNames** (https://www.geonames.org/),
  licensed under **Creative Commons Attribution 4.0** (https://creativecommons.org/licenses/by/4.0/). Built from the dumps
  `cities1000`, `admin1CodesASCII` and `alternatenames/DE` of 2026-11-14 by `build-de-cities.py`: German places with at least
  1,000 inhabitants, city sections and historical places dropped, German names preferred, coordinates rounded to 3 decimals and kept
  only in the public JSON file. Changes: filtered, renamed to the German form, re-encoded.
