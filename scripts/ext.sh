# Build the extension and install it where Chrome can keep pointing at it.
#
# Chrome's "Load unpacked" remembers an absolute path, and `wxt build` deletes
# and recreates .output/chrome-mv3 on every run — which can leave Chrome holding
# a path that briefly stopped existing. Syncing into a stable directory outside
# the repo keeps that pointer valid, and survives `git clean` and moving the repo.

DEST="${AGENT_CONTROL_EXT_DIR:-$HOME/Documents/agent-control-extension}"
BUILT="apps/extension/.output/chrome-mv3"

bun run --filter @agent-control/extension build

if [ ! -f "$BUILT/manifest.json" ]; then
  echo "build produced no manifest at $BUILT" >&2
  exit 1
fi

mkdir -p "$DEST"

# --delete removes files the build dropped; writing in place rather than
# recreating the directory keeps Chrome's pointer on the same inode.
rsync -a --delete "$BUILT/" "$DEST/"

VERSION=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$DEST/manifest.json")

echo
echo "installed version $VERSION to $DEST"
echo
echo "first time:  chrome://extensions -> Developer mode -> Load unpacked -> $DEST"
echo "after that:  chrome://extensions -> reload on the Agent Control card"
