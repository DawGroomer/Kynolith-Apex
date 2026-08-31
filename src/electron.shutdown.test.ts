import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const mainPath = path.join(repositoryRoot, "electron", "main.cjs");

class FakeApp extends EventEmitter {
  isPackaged = false;
  quitRequested = false;
  quitCompleted = false;
  quitInProgress = false;
  beforeQuitPrevented = false;
  quitCount = 0;

  requestSingleInstanceLock(): boolean {
    return true;
  }

  whenReady(): Promise<this> {
    return Promise.resolve(this);
  }

  getAppPath(): string {
    return repositoryRoot;
  }

  getPath(name: string): string {
    assert.equal(name, "userData");
    return os.tmpdir();
  }

  getVersion(): string {
    return "0.3.1-test";
  }

  setAppUserModelId(): void {}

  quit(): void {
    if (this.quitInProgress) return;

    this.quitInProgress = true;
    this.quitCount++;
    this.quitRequested = true;
    this.beforeQuitPrevented = false;
    this.emit("before-quit", {
      preventDefault: () => {
        this.beforeQuitPrevented = true;
      }
    });
    if (!this.beforeQuitPrevented) this.quitCompleted = true;
    this.quitInProgress = false;
  }
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  webContents = { send(): void {} };

  constructor(readonly options: Record<string, unknown>) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  loadURL(): Promise<void> {
    return Promise.resolve();
  }

  setIcon(): void {}
  setAppDetails(): void {}
  hide(): void {}
  show(): void {}
  focus(): void {}
  setAlwaysOnTop(): void {}
  setIgnoreMouseEvents(): void {}
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 1440, height: 900 };
  }
  destroy(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killCalls = 0;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(): boolean {
    this.killCalls++;
    return true;
  }
}

type ShutdownHarness = {
  bridge: FakeChildProcess | undefined;
  bridgeExited: boolean;
  serverStarted: boolean;
  serverCloseCalls: number;
  serverClosePromise: Promise<void>;
  serverCloseSettled: boolean;
};

test(
  "normal Electron close waits for the server and bridge to settle",
  async () => {
    let resolveServerClose!: () => void;
    const harness: ShutdownHarness = {
      bridge: undefined,
      bridgeExited: false,
      serverStarted: false,
      serverCloseCalls: 0,
      serverClosePromise: new Promise<void>(resolve => {
        resolveServerClose = resolve;
      }),
      serverCloseSettled: false
    };
    const originalDesktopFlag = process.env.KYNOLITH_DESKTOP;
    const globalState = globalThis as typeof globalThis & {
      __apexShutdownHarness?: ShutdownHarness;
    };
    globalState.__apexShutdownHarness = harness;

    const app = new FakeApp();
    const bridge = new FakeChildProcess();
    harness.bridge = bridge;
    bridge.once("exit", () => {
      harness.bridgeExited = true;
    });

    const electron = {
      app,
      BrowserWindow: FakeWindow,
      dialog: { showErrorBox(): void {} },
      globalShortcut: {
        register(): boolean {
          return true;
        },
        unregisterAll(): void {}
      },
      ipcMain: { handle(): void {} },
      nativeImage: {
        createFromPath(): { isEmpty(): boolean } {
          return { isEmpty: () => false };
        }
      },
      screen: {
        getPrimaryDisplay(): { bounds: { x: number; y: number; width: number; height: number } } {
          return { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
        },
        getAllDisplays(): Array<{ id: number; bounds: { x: number; y: number; width: number; height: number } }> {
          return [
            { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
          ];
        },
        on(): void {}
      },
      session: {
        defaultSession: {
          setPermissionRequestHandler(): void {},
          setPermissionCheckHandler(): void {}
        }
      },
      shell: { openExternal: async (): Promise<void> => {} }
    };

    const nodeModule = require("node:module") as {
      _load: (
        request: string,
        parent: unknown,
        isMain: boolean
      ) => unknown;
    };
    const originalLoad = nodeModule._load;
    const serverModule = encodeURIComponent(`
      export async function startCoachServer() {
        const state = globalThis.__apexShutdownHarness;
        state.serverStarted = true;
        return {
          port: 4377,
          ingestTelemetry: () => true,
          disconnectTelemetry: async () => {},
          close: () => {
            state.serverCloseCalls++;
            return state.serverClosePromise.then(() => {
              state.serverCloseSettled = true;
            });
          }
        };
      }
    `);

    nodeModule._load = (request, parent, isMain) => {
      if (request === "electron") return electron;
      if (request === "node:child_process") {
        return { spawn: () => bridge };
      }
      if (request === "node:readline") {
        return { createInterface: () => new EventEmitter() };
      }
      if (request === "node:url") {
        return { pathToFileURL: () => ({ href: `data:text/javascript,${serverModule}` }) };
      }
      return originalLoad(request, parent, isMain);
    };

    try {
      require(mainPath);
      for (let attempt = 0; attempt < 20 && !harness.serverStarted; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }

      app.emit("window-all-closed");
      app.quit();
      for (let attempt = 0; attempt < 20 && harness.serverCloseCalls === 0; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }

      assert.equal(harness.serverCloseCalls, 1);
      assert.equal(bridge.killCalls, 1);
      assert.equal(harness.serverCloseSettled, false);
      assert.equal(
        app.quitCompleted,
        false,
        "Electron must not finish quitting while owned shutdown work is pending"
      );

      resolveServerClose();
      bridge.emit("exit");
      bridge.exitCode = 0;
      await harness.serverClosePromise;
      await new Promise<void>(resolve => setImmediate(resolve));

      assert.equal(harness.bridgeExited, true);
      assert.equal(harness.serverCloseSettled, true);
      assert.equal(bridge.killCalls, 1);
      assert.equal(harness.serverCloseCalls, 1);
      assert.equal(
        app.quitCount,
        3,
        "two requested quits plus one guarded final quit"
      );
      assert.equal(app.quitCompleted, true);
    }
    finally {
      nodeModule._load = originalLoad;
      delete require.cache[require.resolve(mainPath)];
      delete globalState.__apexShutdownHarness;
      if (originalDesktopFlag === undefined) delete process.env.KYNOLITH_DESKTOP;
      else process.env.KYNOLITH_DESKTOP = originalDesktopFlag;
    }
  }
);

test("native HUD close quits Apex while in-app close returns to the dashboard", async () => {
  const main = await readFile(mainPath, "utf8");
  assert.match(
    main,
    /hudWindow\.on\("close", event => \{[\s\S]*?if \(quitting\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?app\.quit\(\);[\s\S]*?\}\);/,
    "native HUD close must route through the application quit lifecycle"
  );

  const closeHudStart = main.indexOf("function closeHudWindow()");
  const closeHudEnd = main.indexOf("\nfunction setHudLocked", closeHudStart);
  assert.notEqual(closeHudStart, -1, "in-app HUD close handler must exist");
  assert.notEqual(closeHudEnd, -1, "in-app HUD close handler boundary must exist");

  const closeHudBody = main.slice(closeHudStart, closeHudEnd);
  assert.match(closeHudBody, /hudWindow\.hide\(\)/);
  assert.match(closeHudBody, /mainWindow\?\.show\(\)/);
  assert.match(closeHudBody, /mainWindow\?\.focus\(\)/);
  assert.doesNotMatch(closeHudBody, /app\.quit\(\)/);
});
