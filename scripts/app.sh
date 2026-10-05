# Build an unsigned Agent Control.app and run it, with the server's log in this
# terminal.
#
# The app finds its server at Contents/MacOS inside its own bundle, so it can't
# run straight out of .build. The server it spawns writes JSON to the log file
# rather than this terminal, so the file is followed and pretty-printed here.

DESKTOP_DIR="apps/desktop"
APP="$DESKTOP_DIR/build/local/Agent Control.app"
LOG="$HOME/Library/Logs/AgentControl/server.log"

bun run --filter @agent-control/server build
swift build --package-path "$DESKTOP_DIR"
SWIFT_BIN="$(swift build --package-path "$DESKTOP_DIR" --show-bin-path)/AgentControl"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$DESKTOP_DIR/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$DESKTOP_DIR/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp "$SWIFT_BIN" "$APP/Contents/MacOS/Agent Control"
cp apps/server/dist/agent-control-server "$APP/Contents/MacOS/agent-control-server"

mkdir -p "$(dirname "$LOG")"
touch "$LOG"
# through a fifo rather than a pipe so both pids are known and neither outlives
# the app
FIFO="$(mktemp -u)"
mkfifo "$FIFO"
apps/server/node_modules/.bin/pino-pretty --colorize --ignore pid,hostname <"$FIFO" &
PRETTY_PID=$!
tail -n 0 -F "$LOG" >"$FIFO" &
TAIL_PID=$!
trap 'kill "$TAIL_PID" "$PRETTY_PID" 2>/dev/null; rm -f "$FIFO"' EXIT

# run directly rather than with `open` so stopping miso quits the app, and the
# server exits with it when its stdin closes
"$APP/Contents/MacOS/Agent Control"
