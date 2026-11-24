#!/usr/bin/env python3
"""Builds the German city list of STREET DEX (M5.9b, ADR-508) from GeoNames.

Source: GeoNames (https://www.geonames.org/), licence CC BY 4.0 — attribution in web/database/data/CREDITS.md and on the legal
licences page. Inputs are the public dumps (download them into an empty folder of their own; they are untrusted data):

    curl -o cities1000.zip https://download.geonames.org/export/dump/cities1000.zip && unzip cities1000.zip
    curl -o admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
    curl -o altDE.zip https://download.geonames.org/export/dump/alternatenames/DE.zip && unzip altDE.zip   (→ DE.txt)
    python3 -I web/database/data/build-de-cities.py <folder> <YYYYMMDD of the download>

Outputs (both committed):
- web/database/data/de_cities.csv  — id, name, ascii_name, bundesland, population (NO coordinates; the de_cities table is seeded
  from it, so no spot-related table ever holds a coordinate).
- web/public/geo/de-cities.json    — {v, source, licence, cities: [[id, name, bundesland, lat, lng, population], …]}: public
  reference geography for the app's on-device nearest-city lookup and the public spot map (city circles). Never joined to a spot.

Kept: populated places with ≥ 1,000 inhabitants (the cities1000 dump) in Germany, feature codes PPL, PPLA…PPLA4, PPLC, PPLF, PPLL.
Dropped: PPLX (sections of a city, e.g. districts), PPLH (historical), PPLW (destroyed), PPLQ (abandoned).
Names: GeoNames' main name is sometimes an English exonym ("Munich"); the German alternate name wins (preferred `de` name; else the
main name when it is also a `de` name; else a non-historic, non-colloquial `de` name, the umlaut spelling before "ue/oe/ae").
"""

import csv
import json
import os
import sys

KEEP = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLF", "PPLL"}
# GeoNames admin1 code of Germany → our Bundesland code (App\Enums\Bundesland).
BUNDESLAND = {
    "01": "BW", "02": "BY", "03": "HB", "04": "HH", "05": "HE", "06": "NI", "07": "NW", "08": "RP",
    "09": "SL", "10": "SH", "11": "BB", "12": "MV", "13": "SN", "14": "ST", "15": "TH", "16": "BE",
}

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(os.path.dirname(HERE))


def german_names(folder: str, ids: set) -> dict:
    """geonameid → list of (name, preferred) of its current German names, from the alternate names of DE."""
    names: dict = {}
    path = os.path.join(folder, "DE.txt")
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            f = line.rstrip("\n").split("\t")
            if len(f) < 8 or f[2] != "de":
                continue
            gid = int(f[1])
            if gid not in ids or f[6] == "1" or f[7] == "1":  # colloquial or historic
                continue
            names.setdefault(gid, []).append((f[3].strip(), f[4] == "1"))
    return names


def pick(main: str, candidates: list) -> str:
    if not candidates:
        return main
    preferred = [n for n, p in candidates if p]
    if preferred:
        return preferred[0]
    plain = [n for n, _ in candidates]
    if main in plain:
        return main
    with_umlaut = [n for n in plain if any(ch in n for ch in "äöüÄÖÜß")]
    return (with_umlaut or plain)[0]


def tidy(name: str) -> str:
    """"Stadt Schwedt/Oder" → "Schwedt/Oder", "Lichtenfels / Bayern" → "Lichtenfels/Bayern"."""
    if name.startswith("Stadt ") and len(name) > 6:
        name = name[6:]
    return name.replace(" / ", "/").strip()


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    folder, stamp = sys.argv[1], sys.argv[2]
    rows = []
    with open(os.path.join(folder, "cities1000.txt"), encoding="utf-8") as handle:
        for line in handle:
            f = line.rstrip("\n").split("\t")
            if len(f) < 19 or f[8] != "DE" or f[7] not in KEEP:
                continue
            bundesland = BUNDESLAND.get(f[10])
            population = int(f[14] or 0)
            if bundesland is None or population < 1000:
                continue
            rows.append({
                "id": int(f[0]),
                "name": f[1].strip(),
                "ascii_name": f[2].strip(),
                "bundesland": bundesland,
                "population": population,
                "lat": round(float(f[4]), 3),
                "lng": round(float(f[5]), 3),
            })
    german = german_names(folder, {r["id"] for r in rows})
    renamed = 0
    for r in rows:
        name = tidy(pick(r["name"], german.get(r["id"], [])))
        if name != r["name"]:
            renamed += 1
            r["name"] = name
    print(f"{renamed} names replaced by their German form")
    rows.sort(key=lambda r: (-r["population"], r["name"], r["id"]))

    with open(os.path.join(HERE, "de_cities.csv"), "w", encoding="utf-8", newline="") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["id", "name", "ascii_name", "bundesland", "population"])
        for r in rows:
            writer.writerow([r["id"], r["name"], r["ascii_name"], r["bundesland"], r["population"]])

    geo = os.path.join(WEB, "public", "geo")
    os.makedirs(geo, exist_ok=True)
    payload = {
        "v": f"geonames-{stamp}",
        "source": "GeoNames (geonames.org)",
        "licence": "CC BY 4.0",
        "cities": [[r["id"], r["name"], r["bundesland"], r["lat"], r["lng"], r["population"]] for r in rows],
    }
    with open(os.path.join(geo, "de-cities.json"), "w", encoding="utf-8") as out:
        json.dump(payload, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")

    print(f"{len(rows)} cities written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
