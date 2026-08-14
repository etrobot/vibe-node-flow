#!/usr/bin/env bash
#
# MP4 render entry point for the `app-video-render` node.
#
# The host launches this file by absolute path — it does not know what is inside
# it, and there is no `package.json` script standing in the middle. Anything this
# node needs to produce an MP4 belongs here or beside it; nothing about it should
# leak into the host project.
#
# Contract with the host (server/video-render-terminal.ts):
#   render-video.sh --run-id <id> --base-url <url> --out <absolute mp4 path>
# Exit 0 means the file at --out exists. Any non-zero exit is shown in the
# terminal the host opened.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

RUN_ID=""
BASE_URL=""
OUT_PATH=""

usage() {
  cat <<'USAGE'
Usage: render-video.sh --run-id <id> --base-url <url> --out <path>

  --run-id     Workflow run whose video spec should be rendered.
  --base-url   Origin of the running studio server, e.g. http://127.0.0.1:3000
  --out        Absolute path the finished MP4 must be written to.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)   RUN_ID="${2:-}";   shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --out)      OUT_PATH="${2:-}"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n\n' "$1" >&2; usage >&2; exit 64 ;;
  esac
done

fail() { printf '\n[render-video] %s\n' "$1" >&2; exit "${2:-1}"; }

[[ -n "$RUN_ID"   ]] || fail 'Missing --run-id' 64
[[ -n "$BASE_URL" ]] || fail 'Missing --base-url' 64
[[ -n "$OUT_PATH" ]] || fail 'Missing --out' 64

printf '[render-video] run %s\n' "$RUN_ID"
printf '[render-video] studio %s\n' "$BASE_URL"
printf '[render-video] output %s\n' "$OUT_PATH"

# ---- Preflight -------------------------------------------------------------
missing=()
for tool in node curl ffmpeg; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  fail "Not on PATH: ${missing[*]}. Install them first (macOS: brew install ffmpeg)."
fi
command -v ffprobe >/dev/null 2>&1 \
  || printf '[render-video] note: ffprobe is not on PATH; duration will not be verified.\n'

# ---- Fetch the spec --------------------------------------------------------
# Proves the run, the server, and the capability wiring are all good before any
# expensive work starts.
SPEC_FILE="$(mktemp -t render-video-spec)"
trap 'rm -f "$SPEC_FILE"' EXIT

SPEC_URL="${BASE_URL%/}/api/video/spec/${RUN_ID}"
if ! curl -fsS "$SPEC_URL" -o "$SPEC_FILE"; then
  fail "Could not read the video spec from $SPEC_URL. Is the studio server running?"
fi

# The endpoint returns the node's output, which is itself JSON text, so the
# payload arrives double-encoded. Which node answered decides the shape: a
# render manifest nests the storyboard under `document`, a project manifest or
# raw storyboard carries `clips` at the top level.
node -e '
  const fs = require("node:fs");
  let spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (typeof spec === "string") spec = JSON.parse(spec);
  const doc = spec && typeof spec.document === "object" && spec.document ? spec.document : spec;
  const clips = Array.isArray(doc.clips) ? doc.clips.length : 0;
  const timeline = Array.isArray(spec.timeline) ? spec.timeline.length : 0;
  console.log(`[render-video] spec: slug=${spec.slug ?? "?"} clips=${clips} timeline=${timeline}`);
  if (!clips) {
    console.log("[render-video] warning: this spec carries no clips; check the upstream nodes.");
  }
' "$SPEC_FILE"

# ---- Render ----------------------------------------------------------------
# The frame capture step needs a browser driver, so it lives in a Node entry
# beside this script rather than in bash. When that file lands, this hands off
# to it and never changes again.
for candidate in "$SCRIPT_DIR/scripts/render-video.mjs" "$SCRIPT_DIR/scripts/render-video.ts"; do
  if [[ -f "$candidate" ]]; then
    printf '[render-video] handing off to %s\n' "${candidate#"$SCRIPT_DIR"/}"
    mkdir -p "$(dirname -- "$OUT_PATH")"
    exec node "$candidate" --run-id "$RUN_ID" --base-url "$BASE_URL" --out "$OUT_PATH" --spec "$SPEC_FILE"
  fi
done

cat >&2 <<EOF

[render-video] No renderer implementation is installed.

  The wiring above is working: the studio server answered, the run has a video
  spec, and the toolchain is present. What is missing is the step that turns the
  spec into frames.

  To supply it, add one of:

    $SCRIPT_DIR/scripts/render-video.mjs
    $SCRIPT_DIR/scripts/render-video.ts

  It will be run as:

    node <file> --run-id <id> --base-url <url> --out <mp4> --spec <json file>

  and must write the MP4 to --out. Two pieces already exist to build on:

    - The browser render harness in renderer/RenderEntrypoints.tsx, driven at
      <base-url>/?videoRender=1&render=player&run=<run-id> with
      window.__setPlayerTime(t) per frame.
      Note it currently fetches /api/projects/:name, which server/api.ts does
      not implement; /api/video/spec/:runId is the endpoint that does.
    - buildMuxArgs() in render.ts, which lays each clip's narration on the
      timeline at the offsets fish-audio-narration measured.

EOF
exit 2
