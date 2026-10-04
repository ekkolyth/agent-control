# agent-control

MCP server plus Chrome extension that lets an AI client drive a logged-in
browser tab.

## Setup

```sh
bun install
miso dev   # server on http://127.0.0.1:3660, --port to change
miso ext   # build the extension into ~/Documents/agent-control-extension
miso app   # build and run the menu bar app unsigned, with its server log here
```

Load that directory once via `chrome://extensions` → Developer mode → Load
unpacked. After later `miso ext` runs, hit reload on the extension's card.
`AGENT_CONTROL_EXT_DIR` changes the install path.

Click the extension icon on a tab and press Connect to pair it. Point your
MCP client at `http://127.0.0.1:3660/mcp`.

## Tests

```sh
bun run test
bun run e2e   # rebuilds the extension, then runs Playwright against it
```
