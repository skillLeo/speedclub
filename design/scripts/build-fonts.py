#!/usr/bin/env python3
"""build-fonts: the SPEED CLUB Design System 2.0 fonts (docs/09_PREMIUM_2_0.md section 4.2, ADR-402).

Reads design/fonts/fonts.lock.json (pinned source URLs + SHA-256, the subset recipe, the tool pins) and writes design/fonts/:
  ttf/         Inter 4.1 Regular/Medium/SemiBold/Bold and Inter Display SemiBold/Bold, copied byte for byte from the
               rsms/inter release; Archivo Condensed (wdth 75) and Archivo SemiExpanded (wdth 112.5) SemiBold/Bold, static
               instances cut from google/fonts Archivo[wdth,wght].ttf with fontTools varLib.instancer, each with its own
               family and PostScript name. File name == PostScript name, so one string is the `fontFamily` on iOS
               (PostScript name) and on Android (asset file name).
  web/         one woff2 subset per face (the 09 section 4.2 characters plus the typographic characters the copy uses) and
               <PostScript>-latin-ext.woff2 (Latin Extended-A/B, U+1E9E), which browsers fetch only when a text needs it.
  licences/    OFL-Inter.txt and OFL-Archivo.txt; ship them next to every copy of the fonts.
  fonts.css    @font-face rules (font-display: swap); the template for web/resources/css/fonts.css.
  manifest.json  sources, tool versions and every file with bytes, SHA-256, names, classes, coverage and features. It is
               sealed: "selfSha256" is the SHA-256 of the file with that value as 64 zeros, so a hand edit fails both checks.
Outputs are byte-identical across runs and machines with the same tool versions (head.modified is kept from the sources).

The venv and the download cache live outside the repo:
  python3 -I design/scripts/build-fonts.py --setup    # venv $HOME/.cache/speedclub/fonts-venv, pinned wheels only
  python3 -I design/scripts/build-fonts.py            # build into design/fonts; downloads go to $HOME/.cache/speedclub/fonts-src
  python3 -I design/scripts/build-fonts.py --out DIR --cache DIR   # e.g. a scratch twin build from an empty cache
  python3 -I design/scripts/build-fonts.py --check [--out DIR]    # deep check, no network: seal, files, lock, names,
      # classes, coverage, tnum; web/*.woff2 and fonts.css re-derived from ttf/ byte for byte; manifest.json compared
      # with the manifest the build writes for these files
  node design/scripts/check-fonts.mjs [--dir DIR]     # the fast gate verify runs (no Python)
Both checks exit 0 (ok) or 1 (problems); a damaged or malformed file is reported as a problem, never a crash. --check
exits 2 only when the pinned tools are missing (run --setup).
Any python3 >= 3.10 can start it: when the tools pinned in requirements-fonts.txt are not importable, the script re-runs
itself with the venv's interpreter (--venv overrides the location). Any SHA-256 mismatch of a download aborts the build;
nothing is written into --out unless every output passes verification.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

try:  # the pinned tools live in the venv; main() re-runs the script there when they are missing here
    import fontTools
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    from fontTools.varLib.instancer import OverlapMode
except ImportError:
    fontTools = None

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[2]
FONTS_DIR = REPO / "design" / "fonts"
REQUIREMENTS = SCRIPT.with_name("requirements-fonts.txt")
CACHE_HOME = Path.home() / ".cache" / "speedclub"
DEFAULT_VENV = CACHE_HOME / "fonts-venv"
DEFAULT_CACHE = CACHE_HOME / "fonts-src"

# Default-ignorable code points need no glyph (renderers never draw them); Inter does not map U+00AD.
DEFAULT_IGNORABLE = {0x00AD, 0x034F, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF}
REQUIRED_FEATURES = ("tnum", "kern")
# Managed output folders and the one file type each holds; the build removes stale files of that type there.
MANAGED = {"ttf": ".ttf", "web": ".woff2", "licences": ".txt"}
# Created by Finder/Explorer and gitignored; never part of the font set.
OS_JUNK = {".DS_Store", "Thumbs.db", "desktop.ini"}
# manifest.json's own SHA-256, taken with this value as 64 zeros (seal()); check-fonts.mjs verifies it the same way.
SEAL_KEY = "selfSha256"


# --- small helpers --------------------------------------------------------------------------------------------------
def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return str(path)


def read_json(path: Path) -> dict:
    """A JSON object from disk; anything else stops with a message (--check reports it as a problem)."""
    try:
        value = json.loads(path.read_bytes())
    except FileNotFoundError:
        raise SystemExit(f"build-fonts: {rel(path)} not found")
    except (OSError, ValueError) as exc:  # ValueError: JSONDecodeError, UnicodeDecodeError
        raise SystemExit(f"build-fonts: {rel(path)} is not readable JSON ({exc})")
    if not isinstance(value, dict):
        raise SystemExit(f"build-fonts: {rel(path)} does not hold a JSON object")
    return value


def dump_json(value, indent: int = 0) -> str:
    """json.dumps(indent=2), but arrays of scalars stay on one line (readable manifest diffs)."""
    pad = "  " * indent
    if isinstance(value, dict) and value:
        body = ",\n".join(f"{pad}  {json.dumps(k, ensure_ascii=False)}: {dump_json(v, indent + 1)}" for k, v in value.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(value, list) and any(isinstance(v, (dict, list)) for v in value):
        body = ",\n".join(f"{pad}  {dump_json(v, indent + 1)}" for v in value)
        return "[\n" + body + "\n" + pad + "]"
    return json.dumps(value, ensure_ascii=False)


def parse_ranges(text: str) -> set[int]:
    """'U+0020-007E, U+20AC' -> code points (CSS unicode-range syntax, as written in the lock)."""
    cps: set[int] = set()
    for part in text.split(","):
        part = part.strip().upper()
        if not part.startswith("U+"):
            raise SystemExit(f"build-fonts: bad unicode range {part!r} in the lock")
        lo, _, hi = part[2:].partition("-")
        cps.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return cps


def format_ranges(cps) -> str:
    """Code points -> compact CSS unicode-range ('' when empty)."""
    cps = sorted(cps)
    if not cps:
        return ""
    out, start, prev = [], cps[0], cps[0]
    for cp in cps[1:] + [None]:
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        out.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
        if cp is not None:
            start = prev = cp
    return ", ".join(out)


def parse_pins(lines, where: str) -> dict[str, str]:
    """['fonttools==4.68.0', ...] -> {'fonttools': '4.68.0', ...}; every tool must be pinned exactly."""
    out = {}
    for req in lines:
        name, sep, version = str(req).partition("==")
        if not (sep and name.strip() and version.strip()):
            raise SystemExit(f"build-fonts: {where} must pin every tool with '==': {req!r}")
        out[name.strip()] = version.strip()
    return out


def lock_pins(lock: dict) -> dict[str, str]:
    return parse_pins(lock["tools"]["requirements"], "fonts.lock.json tools.requirements")


def requirement_lines(path: Path) -> list[str]:
    lines = [line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines()]
    return [line for line in lines if line]


def tool_pins() -> dict[str, str]:
    """The tools this script runs with: requirements-fonts.txt. The lock pins the same; the build and both checks compare."""
    return parse_pins(requirement_lines(REQUIREMENTS), rel(REQUIREMENTS))


def installed_versions(names) -> dict[str, str | None]:
    from importlib.metadata import PackageNotFoundError, version

    out: dict[str, str | None] = {}
    for name in names:
        try:
            out[name] = version(name)
        except PackageNotFoundError:
            out[name] = None
    return out


def venv_python(venv: Path) -> Path:
    windows = venv / "Scripts" / "python.exe"
    return windows if windows.exists() else venv / "bin" / "python"


@dataclass(frozen=True)
class Recipe:
    spec: frozenset  # 09 section 4.2: every TTF must cover it
    primary: frozenset  # what each primary woff2 keeps
    primary_name: str
    latin_ext: frozenset  # empty when the lock builds no latin-ext files
    keep_features: tuple
    name_ids: tuple
    hinting: bool
    overlaps: str
    css_url_prefix: str

    @classmethod
    def from_lock(cls, lock: dict) -> "Recipe":
        b = lock["build"]
        charsets = {name: frozenset(parse_ranges(text)) for name, text in b["charsets"].items()}
        if b["archivoOverlaps"] not in ("remove", "keep"):
            raise SystemExit("build-fonts: build.archivoOverlaps must be 'remove' or 'keep'")
        return cls(
            spec=charsets["spec"],
            primary=frozenset().union(*(charsets[n] for n in b["primaryCharsets"])),
            primary_name="+".join(b["primaryCharsets"]),
            latin_ext=charsets["latinExt"] if b["latinExtFiles"] else frozenset(),
            keep_features=tuple(b["keepFeatures"]),
            name_ids=tuple(b["webNameIds"]),
            hinting=bool(b["webHinting"]),
            overlaps=b["archivoOverlaps"],
            css_url_prefix=b["cssUrlPrefix"],
        )


def lock_faces(lock: dict) -> list[dict]:
    """Every face the lock asks for, in output order (Inter release faces, then Archivo instances)."""
    faces = []
    for face in lock["inter"]["faces"]:
        faces.append({k: face[k] for k in ("postScriptName", "cssFamily", "weight", "widthClass")}
                     | {"origin": f"{url_name(lock['inter']['url'])}:{face['member']}"})
    for inst in lock["archivo"]["instances"]:
        axes = " ".join(f"{k}={v}" for k, v in inst["axes"].items())
        faces.append({k: inst[k] for k in ("postScriptName", "cssFamily", "weight", "widthClass")}
                     | {"origin": f"{lock['archivo']['file']} @ {axes}"})
    return faces


def face_files(ps: str, recipe: Recipe) -> dict[str, str]:
    files = {"ttf": f"ttf/{ps}.ttf", "woff2": f"web/{ps}.woff2"}
    if recipe.latin_ext:
        files["woff2LatinExt"] = f"web/{ps}-latin-ext.woff2"
    return files


def url_name(url: str) -> str:
    return unquote(Path(urlsplit(url).path).name)


# --- sources --------------------------------------------------------------------------------------------------------
def fetch(url: str, expected: str, dest: Path) -> Path:
    """Download once into its own cache folder; refuse anything whose SHA-256 differs from the lock."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and sha256_file(dest) == expected:
        return dest
    print(f"build-fonts: downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "speedclub-build-fonts"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
    except OSError as exc:
        raise SystemExit(f"build-fonts: download failed for {url}: {exc}")
    got = sha256_bytes(data)
    if got != expected:
        raise SystemExit(f"build-fonts: SHA-256 mismatch for {url}: expected {expected}, got {got}")
    tmp = dest.with_name(dest.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return dest


def zip_member(zf: zipfile.ZipFile, member: str, expected: str) -> bytes:
    data = zf.read(member)
    got = sha256_bytes(data)
    if got != expected:
        raise SystemExit(f"build-fonts: SHA-256 mismatch for {member}: expected {expected}, got {got}")
    return data


# --- Archivo instances ----------------------------------------------------------------------------------------------
def single_subst_map(font, feature: str) -> dict:
    """Union of the single substitutions behind a GSUB feature (extension lookups unwrapped)."""
    mapping: dict = {}
    if "GSUB" not in font or not font["GSUB"].table.FeatureList:
        return mapping
    gsub = font["GSUB"].table
    indices = {i for fr in gsub.FeatureList.FeatureRecord if fr.FeatureTag == feature for i in fr.Feature.LookupListIndex}
    for i in sorted(indices):
        lookup = gsub.LookupList.Lookup[i]
        for st in lookup.SubTable:
            st = st.ExtSubTable if lookup.LookupType == 7 else st
            mapping.update(getattr(st, "mapping", None) or {})
    return mapping


def set_static_names(font, family: str, style: str) -> str:
    """Unique legacy + typographic names per instance (Google Fonts static convention). Returns the PostScript name.
    The instancer's --update-name-table keeps family 'Archivo' on all four instances (CoreText then groups them as one
    family) and writes PostScript names like 'ArchivoRoman-CondensedSemiBold', so the names are set here instead."""
    name = font["name"]
    ribbi = style in ("Regular", "Bold", "Italic", "Bold Italic")
    ps = f"{family.replace(' ', '')}-{style.replace(' ', '')}"
    vendor = font["OS/2"].achVendID.strip() or "NONE"
    for nid in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):  # 25 = variations PostScript prefix, meaningless in a static font
        name.removeNames(nameID=nid)
    records = {
        1: family if ribbi else f"{family} {style}",
        2: style if ribbi else "Regular",
        3: f"{font['head'].fontRevision:.3f};{vendor};{ps}",
        4: f"{family} {style}",
        6: ps,
    }
    if not ribbi:
        records.update({16: family, 17: style})
    for nid, value in records.items():
        name.setName(value, nid, 3, 1, 0x409)
    # Archivo's Mac-platform records only carry variation names (25, 256-283); Windows records are what every target reads.
    name.names = [r for r in name.names if r.platformID != 1]
    return ps


def set_style_bits(font, style: str) -> None:
    bold, italic = "Bold" in style.split(), "Italic" in style
    os2, head = font["OS/2"], font["head"]
    fs = os2.fsSelection & ~(1 | 32 | 64)
    fs |= (32 if bold else 0) | (1 if italic else 0) | (64 if not bold and not italic else 0)
    os2.fsSelection = fs
    head.macStyle = (head.macStyle & ~0b11) | (1 if bold else 0) | (2 if italic else 0)


def bake_rvrn(font) -> dict:
    """The instancer turns Archivo's FeatureVariations into an always-on rvrn lookup ($ ¢ ₡ ₦ ₩ ₲ ₵ bracket glyphs from
    wght ~478). Point cmap at the substituted glyphs so renderers without OpenType shaping (PHP GD, dompdf) draw what
    HarfBuzz/CoreText draw."""
    mapping = single_subst_map(font, "rvrn")
    changed = {}
    for table in font["cmap"].tables:
        for cp, glyph in list(table.cmap.items()):
            if glyph in mapping:
                table.cmap[cp] = mapping[glyph]
                changed[f"U+{cp:04X}"] = mapping[glyph]
    return dict(sorted(changed.items()))


def build_archivo(vf_path: Path, inst: dict, overlaps: str, out_dir: Path) -> dict:
    vf = TTFont(vf_path, recalcTimestamp=False)
    mode = OverlapMode.REMOVE if overlaps == "remove" else OverlapMode.KEEP_AND_SET_FLAGS
    font = instancer.instantiateVariableFont(vf, dict(inst["axes"]), overlap=mode, static=True)
    ps = set_static_names(font, inst["family"], inst["style"])
    if ps != inst["postScriptName"]:
        raise SystemExit(f"build-fonts: instance names give {ps!r}, the lock expects {inst['postScriptName']!r}")
    set_style_bits(font, inst["style"])
    if "STAT" in font:  # a variable-font table; the pruned copy would only restate this one instance
        del font["STAT"]
    removed = font["name"].removeUnusedNames(font)
    baked = bake_rvrn(font)
    os2 = font["OS/2"]
    if (os2.usWeightClass, os2.usWidthClass) != (inst["weight"], inst["widthClass"]):
        raise SystemExit(f"build-fonts: {ps} has usWeightClass {os2.usWeightClass} / usWidthClass {os2.usWidthClass}, "
                         f"the lock expects {inst['weight']} / {inst['widthClass']}")
    font.recalcTimestamp = False
    font.save(out_dir / f"{ps}.ttf")
    return {"axes": dict(inst["axes"]), "rvrnBakedIntoCmap": baked, "unusedNameIdsRemoved": sorted(removed)}


# --- web subsets ----------------------------------------------------------------------------------------------------
def derive_woff2(ttf: Path, unicodes, recipe: Recipe) -> tuple[bytes, set]:
    """One woff2 subset, identical to: pyftsubset X.ttf --flavor=woff2 --unicodes=... --layout-features+=<keepFeatures>
    --no-hinting --name-IDs=<webNameIds>. pyftsubset's defaults already keep kern, liga, calt, rvrn, locl, ccmp, mark,
    mkmk and frac. Returns the bytes and the source glyphs kept (to tell a dropped no-op feature from a lost one)."""
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = sorted(set(opts.layout_features) | set(recipe.keep_features))
    opts.hinting = recipe.hinting  # Inter's own web fonts are unhinted too (release help.txt)
    opts.name_IDs = list(recipe.name_ids)  # keeps copyright + licence (OFL section 2) in every woff2
    font = subset.load_font(str(ttf), opts)
    font.recalcTimestamp = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(unicodes))
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return buf.getvalue(), set(sub.glyphs_retained)


def css_text(faces: list[dict], recipe: Recipe) -> str:
    lines = [
        "/* Generated by design/scripts/build-fonts.py from design/fonts/fonts.lock.json. Do not edit; rebuild instead.",
        " * Template for web/resources/css/fonts.css: the url()s resolve to web/resources/fonts/2.0/, a copy of the woff2 files",
        " * in design/fonts/web. Self-hosted, no font CDN; OFL licences in design/fonts/licences. The latin-ext files load only",
        " * when a text needs Latin Extended-A/B or U+1E9E (unicode-range). */",
    ]
    parts = [("", recipe.primary)] + ([("-latin-ext", recipe.latin_ext)] if recipe.latin_ext else [])
    for f in faces:
        for suffix, cps in parts:
            lines.append(
                f'@font-face {{ font-family: "{f["cssFamily"]}"; font-style: normal; font-weight: {f["weight"]}; font-display: swap; '
                f'src: url("{recipe.css_url_prefix}{f["postScriptName"]}{suffix}.woff2") format("woff2"); '
                f"unicode-range: {format_ranges(cps)}; }}"
            )
    return "\n".join(lines) + "\n"


# --- verification ---------------------------------------------------------------------------------------------------
def features(font) -> set:
    tags = set()
    for tag in ("GSUB", "GPOS"):
        if tag in font and font[tag].table.FeatureList:
            tags |= {fr.FeatureTag for fr in font[tag].table.FeatureList.FeatureRecord}
    return tags


def tnum_ok(font) -> tuple[bool, int]:
    """tnum works when all ten digits share one advance width once its substitutions apply."""
    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    digits = [cmap.get(0x30 + d) for d in range(10)]
    if None in digits:
        return False, 0
    mapping = single_subst_map(font, "tnum")
    advances = {hmtx[mapping.get(g, g)][0] for g in digits}
    return len(advances) == 1, advances.pop() if len(advances) == 1 else -1


def describe(path: Path, kind: str, recipe: Recipe, source: Path | None = None, retained: set | None = None) -> tuple[dict, list[str]]:
    """Properties recorded in manifest.json, plus the rule violations for this file."""
    font = TTFont(path)

    def get(nid):
        rec = font["name"].getName(nid, 3, 1, 0x409)
        return rec.toUnicode() if rec else None

    cmap = font.getBestCmap()
    feats = features(font)
    os2 = font["OS/2"]
    expected, charset = {"ttf": (recipe.spec, "spec"), "woff2": (recipe.primary, recipe.primary_name),
                         "woff2-latin-ext": (recipe.latin_ext, "latinExt")}[kind]
    src = TTFont(source) if source else None
    if src is None:  # a full font must cover the 09 section 4.2 set itself
        wanted = [cp for cp in sorted(expected) if cp not in DEFAULT_IGNORABLE]
        not_in_source = []
    else:  # a subset can only keep what its source maps
        src_cmap = src.getBestCmap()
        wanted = [cp for cp in sorted(expected) if cp in src_cmap]
        not_in_source = [cp for cp in sorted(expected) if cp not in src_cmap and cp not in DEFAULT_IGNORABLE]
    missing = [cp for cp in wanted if cp not in cmap]
    info = {
        "names": {
            "family": get(16) or get(1),
            "style": get(17) or get(2),
            "legacyFamily": get(1),
            "legacyStyle": get(2),
            "fullName": get(4),
            "postScriptName": get(6),
            "uniqueId": get(3),
            "version": get(5),
        },
        "usWeightClass": os2.usWeightClass,
        "usWidthClass": os2.usWidthClass,
        "fsSelection": {"bold": bool(os2.fsSelection & 32), "italic": bool(os2.fsSelection & 1), "regular": bool(os2.fsSelection & 64)},
        "glyphs": font["maxp"].numGlyphs,
        "codePoints": len(cmap),
        "hinted": "fpgm" in font or "prep" in font,
        "features": sorted(feats),
        "coverage": {"charset": charset, "missing": format_ranges(missing), "notInSource": format_ranges(not_in_source)},
        "variationTables": [t for t in ("fvar", "gvar", "avar", "HVAR", "VVAR", "MVAR", "cvar", "STAT") if t in font],
    }
    errors = []
    if kind == "woff2-latin-ext":  # no digits in this file, so no tnum; kerning of the accented letters must survive
        required = ("kern",)
    else:
        ok, advance = tnum_ok(font)
        info["tnum"] = {"functional": ok, "advance": advance}
        if not ok:
            errors.append("tnum not functional")
        required = REQUIRED_FEATURES
    errors += [f"no {f}" for f in required if f not in feats]
    if kind == "woff2" and src is not None:
        lost, noop = [], []
        for feat in sorted((features(src) & (set(recipe.keep_features) | {"kern", "liga", "calt", "rvrn"})) - feats):
            inputs = set(single_subst_map(src, feat))
            # A single-substitution feature whose inputs the subset does not hold does nothing there (Archivo lnum maps
            # only .osf figures; rvrn's inputs are unreachable once baked into cmap), so pyftsubset drops it correctly.
            (noop if inputs and retained is not None and not inputs & retained else lost).append(feat)
        info["featuresDroppedAsNoop"] = noop
        if lost:
            errors.append(f"features lost against the source: {lost}")
    if missing:
        errors.append(f"missing {format_ranges(missing)}")
    if info["variationTables"]:
        errors.append(f"variation tables left: {info['variationTables']}")
    return info, errors


def face_errors(face: dict, info: dict, path: Path) -> list[str]:
    """The names and classes iOS, Android and CSS resolve must be the ones the lock asks for."""
    names, errs = info["names"], []
    stem = path.name.removesuffix(path.suffix).removesuffix("-latin-ext")
    if names["postScriptName"] != face["postScriptName"]:
        errs.append(f"PostScript name {names['postScriptName']!r}, the lock expects {face['postScriptName']!r}")
    if stem != names["postScriptName"]:
        errs.append("file name != PostScript name")
    if names["family"] != face["cssFamily"]:
        errs.append(f"family {names['family']!r} != cssFamily {face['cssFamily']!r}")
    if (info["usWeightClass"], info["usWidthClass"]) != (face["weight"], face["widthClass"]):
        errs.append(f"usWeightClass/usWidthClass {info['usWeightClass']}/{info['usWidthClass']}, "
                    f"the lock expects {face['weight']}/{face['widthClass']}")
    return errs


def duplicate_errors(ttf_infos: list[dict]) -> list[str]:
    errs = []
    keys = {
        "PostScript name": [i["names"]["postScriptName"] for i in ttf_infos],
        "full name": [i["names"]["fullName"] for i in ttf_infos],
        "legacy family + style": [(i["names"]["legacyFamily"], i["names"]["legacyStyle"]) for i in ttf_infos],
        "family + weight": [(i["names"]["family"], i["usWeightClass"]) for i in ttf_infos],
    }
    for label, values in keys.items():
        dupes = sorted({str(v) for v in values if values.count(v) > 1})
        if dupes:
            errs.append(f"duplicate {label}: {dupes}")
    return errs


def seal_span(data: bytes) -> tuple[int, int] | None:
    """Byte span of the selfSha256 value in manifest.json; None when it is missing, repeated or not 64 hex digits."""
    marker = f'"{SEAL_KEY}": "'.encode("ascii")
    if data.count(marker) != 1:
        return None
    start = data.index(marker) + len(marker)
    end = start + 64
    return (start, end) if re.fullmatch(rb"[0-9a-f]{64}", data[start:end]) and data[end:end + 1] == b'"' else None


def seal(manifest: dict) -> bytes:
    """manifest.json as written: selfSha256 is the SHA-256 of these bytes taken with that value as 64 zeros, so both
    checks also catch an edit of manifest.json itself, not only of the files it lists."""
    data = (dump_json(manifest | {SEAL_KEY: "0" * 64}) + "\n").encode("utf-8")
    span = seal_span(data)
    if span is None:
        raise SystemExit("build-fonts: cannot seal manifest.json")
    return data[:span[0]] + sha256_bytes(data).encode("ascii") + data[span[1]:]


def seal_problems(data: bytes) -> list[str]:
    span = seal_span(data)
    if span is None:
        return [f"manifest.json: no single valid {SEAL_KEY} (rebuild; never edit manifest.json by hand)"]
    start, end = span
    if sha256_bytes(data[:start] + b"0" * 64 + data[end:]).encode("ascii") != data[start:end]:
        return [f"manifest.json: edited after the build ({SEAL_KEY} does not match its content; rebuild, never edit by hand)"]
    return []


def tree_problems(root: Path, manifest: dict) -> list[str]:
    """Every file under root (but manifest.json) is listed with the same bytes and SHA-256, and nothing listed is missing."""
    problems, listed, seen = [], {}, set()
    for i, f in enumerate(manifest.get("files") or []):
        if isinstance(f, dict) and isinstance(f.get("path"), str) and isinstance(f.get("bytes"), int) \
                and isinstance(f.get("sha256"), str):
            listed[f["path"]] = f
        else:
            problems.append(f"manifest.json files[{i}]: needs path, bytes and sha256")
    for p in sorted(root.rglob("*")):
        if p.name in OS_JUNK or p == root / "manifest.json" or (p.is_dir() and not p.is_symlink()):
            continue
        name = p.relative_to(root).as_posix()
        seen.add(name)
        if p.is_symlink():
            problems.append(f"{name}: symlinks are not allowed")
            continue
        entry = listed.get(name)
        if entry is None:
            problems.append(f"{name}: not listed in manifest.json")
            continue
        data = p.read_bytes()
        if len(data) != entry["bytes"] or sha256_bytes(data) != entry["sha256"]:
            problems.append(f"{name}: bytes/SHA-256 differ from manifest.json")
    problems += [f"{name}: listed in manifest.json but missing" for name in sorted(set(listed) - seen)]
    return problems


def lock_problems(manifest: dict, lock: dict) -> list[str]:
    """manifest.json was built from this lock, with these tool pins, and the requirements file pins the same tools."""
    problems = []
    if manifest.get("schema") != 1 or lock.get("schema") != 1:
        problems.append("manifest.json and fonts.lock.json must both be schema 1")
    if manifest.get("build") != lock["build"]:
        problems.append("manifest.json build recipe differs from fonts.lock.json build (rebuild)")
    for family, members in (("inter", "faces"), ("archivo", "instances")):
        if manifest.get("sources", {}).get(family) != {k: v for k, v in lock[family].items() if k != members}:
            problems.append(f"manifest.json sources.{family} differs from fonts.lock.json (rebuild)")
    want_faces = [{k: f[k] for k in ("postScriptName", "cssFamily", "weight", "widthClass")} for f in lock_faces(lock)]
    got_faces = [{k: f.get(k) for k in ("postScriptName", "cssFamily", "weight", "widthClass")} for f in manifest.get("faces", [])]
    if got_faces != want_faces:
        problems.append("manifest.json faces differ from the lock's faces and instances (rebuild)")
    recipe = Recipe.from_lock(lock)
    files = {f["path"]: f for f in manifest.get("files", [])}
    for face in manifest.get("faces", []):
        want = face_files(face["postScriptName"], recipe)
        if face.get("files") != want:
            problems.append(f"manifest.json faces[{face['postScriptName']}].files should be {want}")
        problems += [f"{path}: expected by the lock, not in manifest.json files" for path in want.values() if path not in files]
    for face in lock["inter"]["faces"]:  # release TTFs are byte copies
        entry = files.get(f"ttf/{face['postScriptName']}.ttf")
        if entry and entry["sha256"] != face["sha256"]:
            problems.append(f"ttf/{face['postScriptName']}.ttf is not the pinned release file")
    for lic in (lock["inter"]["licence"], lock["archivo"]["licence"]):
        entry = files.get(f"licences/{lic['as']}")
        if not entry or entry["sha256"] != lic["sha256"]:
            problems.append(f"licences/{lic['as']} is missing or not the pinned licence text")
    if "fonts.lock.json" not in files:
        problems.append("fonts.lock.json is not listed in manifest.json")
    tools = manifest.get("tools", {})
    for name, version in lock_pins(lock).items():
        if tools.get(name) != version:
            problems.append(f"manifest.json was built with {name} {tools.get(name)}, the lock pins {version}")
    if sorted(requirement_lines(REQUIREMENTS)) != sorted(lock["tools"]["requirements"]):
        problems.append(f"{rel(REQUIREMENTS)} and fonts.lock.json tools.requirements pin different tools")
    return problems


# --- build ----------------------------------------------------------------------------------------------------------
def make_manifest(root: Path, lock: dict, recipe: Recipe, notes: dict, retained: dict,
                  python: str | None = None) -> tuple[dict, list[str]]:
    """The manifest for the files in root, plus every rule violation. The build runs it on its staging folder; --check
    runs it on the fonts folder and compares the result with the manifest.json there."""
    faces = lock_faces(lock)
    entries: dict[str, dict] = {}
    errors: list[str] = []
    ttf_infos = []
    for face in faces:
        ps = face["postScriptName"]
        paths = face_files(ps, recipe)
        ttf = root / paths["ttf"]
        targets = [("ttf", paths["ttf"], None)] + [("woff2", paths["woff2"], ttf)]
        if "woff2LatinExt" in paths:
            targets.append(("woff2-latin-ext", paths["woff2LatinExt"], ttf))
        for kind, path, source in targets:
            entry = entries[path] = {"kind": kind}
            try:  # a damaged file is a finding, not a crash
                info, errs = describe(root / path, kind, recipe, source=source,
                                      retained=retained.get(ps) if kind == "woff2" else None)
            except Exception as exc:
                errors.append(f"{path}: cannot be read as a font ({type(exc).__name__}: {exc})")
                continue
            errs += face_errors(face, info, root / path)
            errors += [f"{path}: {e}" for e in errs]
            entry["font"] = info
            if source is not None:
                entry["subsetOf"] = paths["ttf"]
            if kind == "ttf":
                ttf_infos.append(info)
                if ps in notes:
                    entry["archivo"] = notes[ps]
    errors += duplicate_errors(ttf_infos)
    entries["fonts.css"] = {"kind": "css"}
    entries["fonts.lock.json"] = {"kind": "lock"}
    for lic in (lock["inter"]["licence"], lock["archivo"]["licence"]):
        entries[f"licences/{lic['as']}"] = {"kind": "licence"}
    on_disk = {p.relative_to(root).as_posix() for p in root.rglob("*")
               if p.is_file() and p.name not in OS_JUNK and p != root / "manifest.json"}
    if on_disk != set(entries):
        errors.append(f"outputs differ from the lock: missing {sorted(set(entries) - on_disk)}, "
                      f"not expected {sorted(on_disk - set(entries))}")
    files = []
    for path in sorted(entries):
        if path not in on_disk:
            continue
        data = (root / path).read_bytes()
        if entries[path]["kind"] in ("css", "lock", "licence") and b"\r" in data:
            errors.append(f"{path}: contains CR; .gitattributes (text=auto eol=lf) would rewrite it and break the SHA-256")
        files.append({"path": path, "kind": entries[path]["kind"], "bytes": len(data), "sha256": sha256_bytes(data)}
                     | {k: v for k, v in entries[path].items() if k != "kind"})
    totals = {}
    for kind, key in (("ttf", "ttfBytes"), ("woff2", "woff2Bytes"), ("woff2-latin-ext", "woff2LatinExtBytes")):
        totals[key] = sum(f["bytes"] for f in files if f["kind"] == kind)
    manifest = {
        "schema": 1,
        "generator": "design/scripts/build-fonts.py",
        "spec": "docs/09_PREMIUM_2_0.md §4.2, ADR-402",
        SEAL_KEY: "0" * 64,  # filled in by seal() when the file is written
        "tools": {"python": python or sys.version.split()[0]} | installed_versions(lock_pins(lock)),
        "build": lock["build"],
        "unicodeRanges": {"primary": format_ranges(recipe.primary), "latinExt": format_ranges(recipe.latin_ext)},
        "sources": {family: {k: v for k, v in lock[family].items() if k != members}
                    for family, members in (("inter", "faces"), ("archivo", "instances"))},
        "faces": [face | {"files": face_files(face["postScriptName"], recipe)} for face in faces],
        "totals": totals,
        "files": files,
    }
    return manifest, errors


def guard_out(out: Path) -> None:
    """The build removes stale font files inside --out, so it only writes into an empty or an existing fonts folder."""
    if out.exists() and any(out.iterdir()) and not ((out / "manifest.json").exists() or (out / "fonts.lock.json").exists()):
        raise SystemExit(f"build-fonts: {out} is not empty and holds no manifest.json or fonts.lock.json; refusing to write there")


def sync(stage: Path, out: Path, listed: list[str]) -> tuple[list[str], list[str]]:
    out.mkdir(parents=True, exist_ok=True)
    removed, written = [], []
    for sub, suffix in MANAGED.items():
        folder = out / sub
        if folder.is_dir():
            for p in sorted(folder.iterdir()):
                if p.is_file() and p.suffix == suffix and f"{sub}/{p.name}" not in listed:
                    p.unlink()
                    removed.append(f"{sub}/{p.name}")
    for name in listed + ["manifest.json"]:
        data = (stage / name).read_bytes()
        dest = out / name
        if not dest.exists() or dest.read_bytes() != data:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            written.append(name)
    return removed, written


def build(lock_path: Path, lock: dict, cache: Path, out: Path) -> int:
    guard_out(out)
    recipe = Recipe.from_lock(lock)
    stage = Path(tempfile.mkdtemp(prefix="speedclub-fonts-"))
    try:
        for sub in MANAGED:
            (stage / sub).mkdir()
        inter = lock["inter"]
        zip_path = fetch(inter["url"], inter["sha256"], cache / "inter" / url_name(inter["url"]))
        with zipfile.ZipFile(zip_path) as zf:
            for face in inter["faces"]:
                if Path(face["member"]).stem != face["postScriptName"]:
                    raise SystemExit(f"build-fonts: {face['member']} is not named after {face['postScriptName']}")
                (stage / "ttf" / f"{face['postScriptName']}.ttf").write_bytes(zip_member(zf, face["member"], face["sha256"]))
            lic = inter["licence"]
            (stage / "licences" / lic["as"]).write_bytes(zip_member(zf, lic["member"], lic["sha256"]))

        archivo = lock["archivo"]
        vf = fetch(archivo["url"], archivo["sha256"], cache / "archivo" / archivo["file"])
        ofl = fetch(archivo["licence"]["url"], archivo["licence"]["sha256"], cache / "archivo-ofl" / url_name(archivo["licence"]["url"]))
        shutil.copyfile(ofl, stage / "licences" / archivo["licence"]["as"])
        notes = {inst["postScriptName"]: build_archivo(vf, inst, recipe.overlaps, stage / "ttf") for inst in archivo["instances"]}

        retained = {}
        for face in lock_faces(lock):
            ps = face["postScriptName"]
            paths = face_files(ps, recipe)
            data, retained[ps] = derive_woff2(stage / paths["ttf"], recipe.primary, recipe)
            (stage / paths["woff2"]).write_bytes(data)
            if "woff2LatinExt" in paths:
                (stage / paths["woff2LatinExt"]).write_bytes(derive_woff2(stage / paths["ttf"], recipe.latin_ext, recipe)[0])
        (stage / "fonts.css").write_bytes(css_text(lock_faces(lock), recipe).encode("utf-8"))
        (stage / "fonts.lock.json").write_bytes(lock_path.read_bytes())

        manifest, errors = make_manifest(stage, lock, recipe, notes, retained)
        if errors:
            print("build-fonts: verification failed, nothing written to " + rel(out), file=sys.stderr)
            print("\n".join(f"  {e}" for e in errors), file=sys.stderr)
            return 1
        (stage / "manifest.json").write_bytes(seal(manifest))
        removed, written = sync(stage, out, [f["path"] for f in manifest["files"]])
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    print_table(manifest)
    for name in removed:
        print(f"build-fonts: removed stale {name}")
    print(f"build-fonts: {len(manifest['files'])} files + manifest.json in {rel(out)} ({len(written)} written, rest unchanged)")
    return 0


def print_table(manifest: dict) -> None:
    print(f"{'file':46} {'bytes':>8}  {'sha256':12}  {'PostScript':30} {'wght':>4} {'wdth':>4}  tnum")
    for f in manifest["files"]:
        font = f.get("font")
        if not font:
            continue
        tnum = "yes" if font.get("tnum", {}).get("functional") else ("n/a" if f["kind"] == "woff2-latin-ext" else "NO")
        print(f"{f['path']:46} {f['bytes']:>8}  {f['sha256'][:12]}  {font['names']['postScriptName']:30} "
              f"{font['usWeightClass']:>4} {font['usWidthClass']:>4}  {tnum}")
    t = manifest["totals"]
    print(f"totals: ttf {t['ttfBytes']} B, woff2 {t['woff2Bytes']} B, latin-ext woff2 {t['woff2LatinExtBytes']} B")


# --- check ----------------------------------------------------------------------------------------------------------
def guarded(label: str, fn, *args) -> list[str]:
    """One group of checks; a malformed manifest or lock (missing keys, wrong types) is a finding, never a crash."""
    try:
        return fn(*args)
    except (Exception, SystemExit) as exc:  # SystemExit: Recipe.from_lock and parse_pins stop on a malformed lock
        return [f"{label}: cannot be checked ({type(exc).__name__}: {exc})"]


def manifest_diff(expected: dict, recorded: dict) -> list[str]:
    """Top-level keys, and files by path, where two manifests differ."""
    absent = object()
    where = [k for k in sorted(set(expected) | set(recorded))
             if k != "files" and expected.get(k, absent) != recorded.get(k, absent)]
    want, got = expected["files"], recorded.get("files")
    if not isinstance(got, list) or [f.get("path") if isinstance(f, dict) else None for f in got] != [f["path"] for f in want]:
        return where + ["files (paths or order)"]
    return where + [f"files[{w['path']}]" for w, g in zip(want, got) if w != g]


def deep_problems(out: Path, manifest: dict, lock: dict, compare_manifest: bool) -> list[str]:
    """web/*.woff2 and fonts.css re-derived from ttf/ and compared byte for byte; every font re-read against the lock's
    rules; with an intact file tree, manifest.json compared with the manifest the build writes for these files."""
    recipe = Recipe.from_lock(lock)
    problems: list[str] = []
    retained: dict = {}
    for face in lock_faces(lock):
        ps = face["postScriptName"]
        paths = face_files(ps, recipe)
        ttf = out / paths["ttf"]
        if not ttf.is_file():
            continue  # reported by the file check
        try:  # a damaged file is a finding, not a crash
            derived = {paths["woff2"]: derive_woff2(ttf, recipe.primary, recipe)}
            if "woff2LatinExt" in paths:
                derived[paths["woff2LatinExt"]] = derive_woff2(ttf, recipe.latin_ext, recipe)
        except Exception as exc:
            problems.append(f"{paths['ttf']}: cannot be subset ({type(exc).__name__}: {exc})")
            continue
        retained[ps] = derived[paths["woff2"]][1]
        for path, (data, _kept) in derived.items():
            if (out / path).is_file() and (out / path).read_bytes() != data:
                problems.append(f"{path}: not what {paths['ttf']} and the lock's recipe produce (re-derived bytes differ)")
    css = out / "fonts.css"
    if css.is_file() and css.read_bytes() != css_text(lock_faces(lock), recipe).encode("utf-8"):
        problems.append("fonts.css: not what the lock's faces and recipe produce")
    # Provenance the files cannot show (the Archivo build notes: axes, rvrn mapping, removed name IDs; the Python version)
    # is taken as recorded and covered by the seal; everything else is derived again from the files and the lock.
    notes = {Path(f["path"]).stem: f["archivo"] for f in manifest.get("files") or []
             if isinstance(f, dict) and f.get("kind") == "ttf" and "archivo" in f}
    expected, errors = make_manifest(out, lock, recipe, notes, retained, python=(manifest.get("tools") or {}).get("python"))
    problems += errors
    if compare_manifest:
        expected.pop(SEAL_KEY)
        recorded = {k: v for k, v in manifest.items() if k != SEAL_KEY}
        problems += [f"manifest.json: {where} is not what the build writes for these files (rebuild)"
                     for where in manifest_diff(expected, recorded)]
    return problems


def check(out: Path) -> int:
    """No network. The fast gate's checks (seal, files, lock), then deep_problems(). Exit 0 = ok, 1 = problems."""
    problems: list[str] = []

    def load(name: str) -> dict | None:
        try:
            return read_json(out / name)
        except SystemExit as exc:
            problems.append(str(exc).removeprefix("build-fonts: "))
            return None

    manifest, lock = load("manifest.json"), load("fonts.lock.json")
    if manifest is not None:
        problems += seal_problems((out / "manifest.json").read_bytes())
    if manifest is not None and lock is not None:
        tree = guarded("manifest.json", tree_problems, out, manifest)
        problems += tree
        problems += guarded("fonts.lock.json", lock_problems, manifest, lock)
        problems += guarded("deep check", deep_problems, out, manifest, lock, not tree)
    if problems:
        print("\n".join(problems))
        print(f"build-fonts --check: {len(problems)} problem(s) in {rel(out)}")
        return 1
    fonts = sum(1 for f in manifest["files"] if "font" in f)
    print(f"build-fonts --check: manifest.json is sealed and its {len(manifest['files'])} files match; lock, requirements "
          f"and manifest agree; {fonts} fonts re-verified (names, classes, coverage, tnum, features); web/*.woff2 and "
          f"fonts.css re-derived from ttf/ byte for byte; manifest.json is what the build writes for these files")
    return 0


# --- setup / entry --------------------------------------------------------------------------------------------------
def setup(venv: Path) -> int:
    py = venv_python(venv)
    if not py.exists():
        import venv as venv_module

        print(f"build-fonts: creating {venv}")
        venv_module.EnvBuilder(with_pip=True).create(str(venv))
        py = venv_python(venv)
    cmd = [str(py), "-I", "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:",
           "-r", str(REQUIREMENTS)]
    print("build-fonts: " + " ".join(cmd))
    return subprocess.call(cmd)


def ensure_tools(venv: Path) -> int | None:
    """None when the tools pinned in requirements-fonts.txt are importable here; else the exit code of this command
    re-run inside the venv (2 when the venv lacks them too). A lock in a folder under --check never picks the tools."""
    want = tool_pins()
    have = installed_versions(want) if fontTools is not None else dict.fromkeys(want)
    if have == want:
        return None
    py = venv_python(venv)
    if py.exists() and Path(sys.prefix).resolve() != venv.resolve():
        return subprocess.call([str(py), "-I", str(SCRIPT), *sys.argv[1:]])
    diff = ", ".join(f"{n} {have.get(n) or 'missing'} (needs {v})" for n, v in want.items() if have.get(n) != v)
    print(f"build-fonts: the pinned tools are not installed for {sys.executable}: {diff}.\n"
          f"Set up the venv once: python3 -I {rel(SCRIPT)} --setup   (venv: {venv})", file=sys.stderr)
    return 2


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="deep check of --out against its manifest.json and lock (no network)")
    mode.add_argument("--setup", action="store_true", help="create the venv and install requirements-fonts.txt")
    ap.add_argument("--out", type=Path, default=FONTS_DIR, help="output folder (default: design/fonts)")
    ap.add_argument("--lock", type=Path, default=FONTS_DIR / "fonts.lock.json",
                    help="lock to build from (default: design/fonts/fonts.lock.json); --check reads <out>/fonts.lock.json")
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help=f"download cache (default: {DEFAULT_CACHE})")
    ap.add_argument("--venv", type=Path, default=DEFAULT_VENV, help=f"venv with the pinned tools (default: {DEFAULT_VENV})")
    args = ap.parse_args()
    venv = args.venv.expanduser().absolute()
    if args.setup:
        return setup(venv)
    rerun = ensure_tools(venv)
    if rerun is not None:
        return rerun
    out = args.out.expanduser().resolve()
    if args.check:
        return check(out)
    lock_path = args.lock.expanduser().resolve()
    lock = read_json(lock_path)
    if sorted(requirement_lines(REQUIREMENTS)) != sorted(lock["tools"]["requirements"]):
        raise SystemExit(f"build-fonts: {rel(REQUIREMENTS)} and {rel(lock_path)} tools.requirements pin different tools")
    return build(lock_path, lock, args.cache.expanduser().resolve(), out)


if __name__ == "__main__":
    sys.exit(main())
