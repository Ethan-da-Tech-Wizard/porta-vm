# Porta VM

An experimental host/guest interface and Linux sandbox setup for sharing a virtual-machine workspace.

**Status:** Development prototype  
**Built with:** Node.js, Express, WebSocket, Docker/QEMU scripts

[Project guide](docs/PROJECT_GUIDE.md) · [Every file explained](docs/FILE_GUIDE.md) · [Licenses and dependencies](docs/LICENSE_REVIEW.md)

## Start here

- [host/server.js](host/server.js) — Source module for server; defines `mapPort`, `unmapPort`, `automateBootloader`, `gracefulShutdown`, `connect`, `connectToVnc`, `connectToSerial`.
- [guest/client.js](guest/client.js) — Source module for client; defines `setStatus`, `extractTokenFromHash`, `logSerial`, `connectSession`, `initVncDisplays`, `onVncConnect`, `onVncDisconnect` and 11 more symbols.
- [sandbox](sandbox) — Project entry point and supporting files
- [templates](templates) — Rendered views and document templates

## Repository layout

| Path | Role |
| --- | --- |
| [guest/](guest/) | Project-specific guest components (2 tracked entries). |
| [host/](host/) | Project-specific host components (4 tracked entries). |
| [sandbox/](sandbox/) | Project-specific sandbox components (4 tracked entries). |
| [templates/](templates/) | Rendered views and document templates (3 tracked entries). |

## Scope and current limits

Read the host and sandbox configuration before running. TLS keys are intentionally excluded. Network exposure, UPnP, and guest isolation require deployment-specific review.

## License

Original project code retains **MIT** terms in [LICENSE](LICENSE). Third-party libraries, media, data, models, and tools retain their own terms. See the [license review](docs/LICENSE_REVIEW.md) and [dependency inventory](docs/DEPENDENCIES.csv).
