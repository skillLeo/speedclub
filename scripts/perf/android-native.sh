#!/bin/sh
# Android native baseline helpers (09 §12 Android rows, §14.1 "Android native"). adb only, no Maestro (OA-9).
# Every command targets one device: ANDROID_SERIAL (default emulator-5554), so a connected phone is never touched.
#
#   sh scripts/perf/android-native.sh find <resource-id|text>        → "x y" centre of the first match, exit 1 if none
#   sh scripts/perf/android-native.sh tap <resource-id|text>         → taps that centre
#   sh scripts/perf/android-native.sh wait <resource-id|text> [sec]  → waits until the element is on screen (default 30 s)
#   sh scripts/perf/android-native.sh gone <resource-id|text> [sec]  → waits until it is no longer on screen (e.g. a skeleton)
#   sh scripts/perf/android-native.sh shot <file.png>                → device-resolution PNG (screencap)
#   sh scripts/perf/android-native.sh demo-bar on|off                → SystemUI demo mode: 12:00, full battery, no notification icons
#   sh scripts/perf/android-native.sh coldstart [runs] [activity]    → force-stop + am start -W, prints each run and the medians
#   sh scripts/perf/android-native.sh jank <label> [swipes]          → gfxinfo reset, N swipes up, prints janky % and p50/p90/p95/p99
#                                                                      (JANK_RAW=<file> appends the raw gfxinfo summary)
#   sh scripts/perf/android-native.sh jank-screen <label> <deeplink|-> <ready-id> [runs] [swipes]
#                                                                    → warm-up pass + N measured passes, each from a fresh process
#
# Element matching: a testID becomes the Android resource-id ("HOME-01.root"); otherwise the visible text or the
# content-desc (accessibility label) is matched exactly.
set -eu

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
PKG="${PKG:-de.speedclub.app}"
a() { "$ADB" -s "$SERIAL" "$@"; }

dump() {
  a shell uiautomator dump /sdcard/sc-ui.xml >/dev/null 2>&1 || return 1
  a shell cat /sdcard/sc-ui.xml
}

# Prints the centre "x y" of the first node whose resource-id, text or content-desc equals $1.
find_node() {
  dump | tr '<' '\n' | awk -v key="$1" '
    {
      hit = index($0, "resource-id=\"" key "\"") || index($0, " text=\"" key "\"") || index($0, "content-desc=\"" key "\"")
      if (hit && match($0, /bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"/)) {
        b = substr($0, RSTART + 8, RLENGTH - 9); gsub(/\]\[/, ",", b); gsub(/[\[\]]/, "", b)
        split(b, p, ","); printf "%d %d\n", (p[1] + p[3]) / 2, (p[2] + p[4]) / 2; found = 1; exit
      }
    }
    END { exit found ? 0 : 1 }'
}

median() { sort -n | awk '{ v[NR] = $1 } END { if (NR == 0) { print "n/a"; exit } m = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2; print m }'; }

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  find) find_node "$1" ;;
  tap)
    xy=$(find_node "$1") || { echo "not found: $1" >&2; exit 1; }
    # shellcheck disable=SC2086
    a shell input tap $xy ;;
  wait)
    end=$(( $(date +%s) + ${2:-30} ))
    until find_node "$1" >/dev/null 2>&1; do
      [ "$(date +%s)" -ge "$end" ] && { echo "timeout waiting for: $1" >&2; exit 1; }
      sleep 1
    done ;;
  gone)
    end=$(( $(date +%s) + ${2:-30} ))
    while find_node "$1" >/dev/null 2>&1; do
      [ "$(date +%s)" -ge "$end" ] && { echo "still on screen: $1" >&2; exit 1; }
      sleep 1
    done ;;
  shot) a exec-out screencap -p > "$1" ;;
  demo-bar)
    a shell settings put global sysui_demo_allowed 1
    if [ "${1:-on}" = on ]; then
      a shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
      a shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1200 >/dev/null
      a shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
      a shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e mobile show -e level 4 -e datatype none >/dev/null
      a shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null
    else
      a shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null
    fi ;;
  coldstart)
    runs="${1:-5}"; activity="${2:-$PKG/.MainActivity}"; tmp=$(mktemp)
    i=1
    while [ "$i" -le "$runs" ]; do
      a shell am force-stop "$PKG"; sleep 2
      out=$(a shell am start -W -n "$activity" | tr -d '\r')
      total=$(printf '%s\n' "$out" | awk -F': ' '/^TotalTime/ { print $2 }')
      wait_=$(printf '%s\n' "$out" | awk -F': ' '/^WaitTime/ { print $2 }')
      state=$(printf '%s\n' "$out" | awk -F': ' '/^LaunchState/ { print $2 }')
      echo "run $i: LaunchState=$state TotalTime=${total}ms WaitTime=${wait_}ms"
      # Only a cold launch with both numbers counts: an empty value would read as 0 ms in the median.
      case "$total$wait_" in
        *[!0-9]* | "") echo "  run $i rejected: no TotalTime/WaitTime" ;;
        *) if [ "$state" = "COLD" ]; then echo "$total $wait_" >> "$tmp"; else echo "  run $i rejected: LaunchState $state is not COLD"; fi ;;
      esac
      sleep 8; i=$((i + 1))
    done
    kept=$(wc -l < "$tmp" | tr -d ' ')
    if [ "$kept" -eq 0 ]; then echo "no valid cold start in $runs runs" >&2; rm -f "$tmp"; exit 1; fi
    echo "median TotalTime=$(cut -d' ' -f1 "$tmp" | median)ms WaitTime=$(cut -d' ' -f2 "$tmp" | median)ms (n=$kept of $runs runs)"
    rm -f "$tmp" ;;
  jank)
    label="$1"; swipes="${2:-10}"
    size=$(a shell wm size | awk -F': ' '/Physical/ { print $2 }' | tr -d '\r'); w=${size%x*}; h=${size#*x}
    x=$((w / 2)); y1=$((h * 3 / 4)); y2=$((h / 4))
    a shell dumpsys gfxinfo "$PKG" reset >/dev/null
    i=1
    while [ "$i" -le "$swipes" ]; do
      a shell input swipe "$x" "$y1" "$x" "$y2" 250
      sleep 1; i=$((i + 1))
    done
    sleep 1
    raw=$(a shell dumpsys gfxinfo "$PKG" | tr -d '\r')
    # JANK_RAW=<file> keeps the summary block (frames, janky, percentiles, causes, histogram) as evidence.
    if [ -n "${JANK_RAW:-}" ]; then
      { echo "== $label ($swipes swipes, $(date -u +%Y-%m-%dT%H:%M:%SZ))"; printf '%s\n' "$raw" | sed -n '/^Stats since/,/^HISTOGRAM/p'; echo; } >> "$JANK_RAW"
    fi
    printf '%s\n' "$raw" | awk -v label="$label" '
      /^Total frames rendered/ { total = $4 }
      /^Janky frames:/ && !legacy { janky = $3 " " $4; legacy = 1 }
      /^50th percentile/ { p50 = $3 } /^90th percentile/ { p90 = $3 } /^95th percentile/ { p95 = $3 } /^99th percentile/ { p99 = $3 }
      END { printf "%s: frames=%s janky=%s p50=%s p90=%s p95=%s p99=%s\n", label, total, janky, p50, p90, p95, p99 }' ;;
  jank-screen)
    # Baseline protocol (M4.0): per pass a fresh process (force-stop + launcher start), then the deep link, wait for the screen's
    # element, settle 5 s, `jank`. Pass 0 warms the image disk cache and is discarded; passes 1..N are reported.
    label="$1"; link="$2"; ready="$3"; runs="${4:-3}"; swipes="${5:-10}"; self="$0"
    pass=0
    while [ "$pass" -le "$runs" ]; do
      a shell am force-stop "$PKG"; sleep 2
      a shell am start -W -n "$PKG/.MainActivity" >/dev/null
      if [ "$link" != - ]; then sleep 3; a shell am start -W -a android.intent.action.VIEW -d "$link" "$PKG" >/dev/null; fi
      sh "$self" wait "$ready" 40; sleep 5
      if [ "$pass" -eq 0 ]; then JANK_RAW='' sh "$self" jank "$label warm-up (discarded)" "$swipes"
      else sh "$self" jank "$label pass $pass" "$swipes"; fi
      pass=$((pass + 1))
    done ;;
  *) sed -n '2,18p' "$0"; exit 2 ;;
esac
