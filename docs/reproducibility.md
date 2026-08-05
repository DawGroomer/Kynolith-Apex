# Reproducible Build and Development Guide

This document describes the exact steps required to reproduce the Apex desktop application from source.

## Required tools and environment

- Windows 10/11 x64.
- Node.js installed and available on `PATH`.
- `pnpm` package manager available.
- `cmake` and Windows build tools installed if building the native LMU bridge manually.
- Internet access for initial dependency install and optional model download.
- Local `.NET SDK` for publishing the C# bridge.

## Project-specific dependencies

- The native bridge is built from `bridge/Kynolith.LmuBridge.csproj`.
- The bridge build requires a local .NET SDK, which the project can bootstrap into `.tools/dotnet`.
- The native LMU SDK headers must be available at:
  - `C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate\Support\SharedMemoryInterface`
- Offline model artifacts must be staged under `offline-models` before packaging.

## Setup steps

1. Install project dependencies:

```powershell
pnpm install
```

2. Bootstrap the local .NET SDK if one is not already installed:

```powershell
pnpm bootstrap:dotnet
```

3. Build the native bridge executable:

```powershell
pnpm build:bridge
```

4. Build the TypeScript server:

```powershell
pnpm build
```

5. Stage offline model assets if you intend to produce a release with bundled models.
   This requires a local Hugging Face cache at `.model-smoke-cache\huggingface`.

```powershell
pnpm models:stage
```

6. Run packaging validation before building the portable release:

```powershell
pnpm validate:packaging
```

7. Create the Windows portable distributable:

```powershell
pnpm dist:win
```

8. Optionally smoke-test the portable executable:

```powershell
pnpm smoke:portable
```

## Development workflows

### Run the server locally

```powershell
pnpm start
```

Open `http://127.0.0.1:4377` to view the dashboard.

### Run the desktop app locally

```powershell
pnpm desktop
```

### Run unit tests

```powershell
pnpm test
```

### Run local AI and voice tests

```powershell
pnpm test:local-ai
pnpm test:local-voice
```

### Debugging in VS Code

Use the provided `.vscode/launch.json` profiles:

- `Launch Coach Server (tsx)`
- `Launch Electron Desktop (Main)`
- `Attach to Electron Renderer`
- `Launch Full Coach Workspace`
- `Launch Full Coach + Renderer`

## Packaging validation rules

The repository now enforces the following preconditions before packaging:

- local .NET SDK exists at `.tools\dotnet\dotnet.exe`
- the bridge executable exists at `bridge\publish\Kynolith.LmuBridge.exe`
- compiled server output exists at `dist\server.js`
- the offline model bundle exists under `offline-models`
- the Electron builder file list contains the expected source patterns

## Relevant documentation

- `README.md` — project overview, run instructions, packaging prerequisites
- `DESIGN.md` — architecture and coaching design
- `docs/decision-trees.md` — engine and scheduler decision flow charts
- `docs/reproducibility.md` — exact reproduction and packaging workflow
- `THIRD_PARTY_NOTICES.md` — license and third-party notices
