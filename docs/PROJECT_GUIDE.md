# Porta VM

An experimental host/guest interface and Linux sandbox setup for sharing a virtual-machine workspace.

**Status:** Development prototype  
**Built with:** Node.js, Express, WebSocket, Docker/QEMU scripts

## Reading order

1. Read the root README for project purpose and setup navigation.
2. Follow the entry points below to find the implementation.
3. Use the file guide to locate individual modules, tests, assets, and configuration.
4. Check component licenses before redistributing dependencies or assets.

## Important paths

- [host/server.js](../host/server.js) — Source module for server; defines `mapPort`, `unmapPort`, `automateBootloader`, `gracefulShutdown`, `connect`, `connectToVnc`, `connectToSerial`.
- [guest/client.js](../guest/client.js) — Source module for client; defines `setStatus`, `extractTokenFromHash`, `logSerial`, `connectSession`, `initVncDisplays`, `onVncConnect`, `onVncDisconnect` and 11 more symbols.
- [sandbox](../sandbox) — Project-specific components
- [templates](../templates) — Rendered views and document templates

## Structure

| Path | Role |
| --- | --- |
| [docs/](../docs/) | Project documentation, decisions, and reference material (5 tracked entries). |
| [guest/](../guest/) | Project-specific guest components (2 tracked entries). |
| [host/](../host/) | Project-specific host components (4 tracked entries). |
| [sandbox/](../sandbox/) | Project-specific sandbox components (4 tracked entries). |
| [templates/](../templates/) | Rendered views and document templates (3 tracked entries). |

## Scope

Read the host and sandbox configuration before running. TLS keys are intentionally excluded. Network exposure, UPnP, and guest isolation require deployment-specific review.

## Maintaining the guide

The file catalog is a source-inspection snapshot, not proof that every runtime path works. Update it when moving files or changing module responsibilities. The 2026-10-12 documentation review did not run every application, deploy services, or validate all historical performance claims.
