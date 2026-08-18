import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync
} from "node:fs";
import test from "node:test";
import vm from "node:vm";


test(
  "HUD pedal graph renderer maps bounded telemetry deterministically and draws only validated reference data",
  () => {
    const rendererPath =
      "public/hud-pedal-graph.js";


    assert.equal(
      existsSync(rendererPath),
      true,
      "dedicated HUD pedal graph renderer module must exist"
    );


    const source =
      readFileSync(
        rendererPath,
        "utf8"
      );


    const html =
      readFileSync(
        "public/index.html",
        "utf8"
      );


    const app =
      readFileSync(
        "public/app.js",
        "utf8"
      );


    /*
     * Renderer must load before app.js so the live queue
     * can call it without another dependency mechanism.
     */
    assert.equal(
      (
        html.match(
          /hud-pedal-graph\.js/g
        ) ?? []
      ).length,
      1,
      "renderer script must be loaded exactly once"
    );


    const rendererScriptAt =
      html.indexOf(
        "hud-pedal-graph.js"
      );


    const appScriptAt =
      html.indexOf(
        "app.js"
      );


    assert.ok(
      rendererScriptAt >= 0 &&
      appScriptAt >= 0 &&
      rendererScriptAt < appScriptAt,
      "pedal graph renderer must load before app.js"
    );


    /*
     * Execute the standalone browser renderer without
     * loading the rest of Apex.
     */
    const context: {
      window: Record<string, unknown>;
    } = {
      window: {}
    };


    vm.runInNewContext(
      source,
      context,
      {
        filename:
          rendererPath
      }
    );


    const renderer =
      context.window.apexPedalGraph as {
        buildGeometry?: (
          snapshot: unknown,
          pedal: "brake" | "throttle",
          width: number,
          height: number
        ) => {
          actual: Array<{
            x: number;
            y: number;
          }>;
          reference: Array<{
            x: number;
            y: number;
          }>;
          nowX: number;
        };

        draw?: (
          canvas: unknown,
          snapshot: unknown,
          pedal: "brake" | "throttle"
        ) => void;
      };


    assert.ok(
      renderer,
      "renderer must expose window.apexPedalGraph"
    );


    assert.equal(
      typeof renderer.buildGeometry,
      "function",
      "renderer must expose deterministic geometry builder"
    );


    assert.equal(
      typeof renderer.draw,
      "function",
      "renderer must expose Canvas draw operation"
    );


    const snapshot = {
      state:
        "reference",

      actual: [
        {
          offsetMs: -2500,
          brake: 0.2,
          throttle: 0.1
        },
        {
          offsetMs: 0,
          brake: 0.7,
          throttle: 0.8
        }
      ],

      reference: [
        {
          offsetMs: -2500,
          brake: 0.1,
          throttle: 0.15
        },
        {
          offsetMs: 1500,
          brake: 0.3,
          throttle: 0.9
        }
      ]
    };


    const throttle =
      renderer.buildGeometry!(
        snapshot,
        "throttle",
        400,
        100
      );


    /*
     * Frozen graph domain:
     *
     * -2500 ms ........ NOW ........ +1500 ms
     * x=0               x=250        x=400
     */
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          throttle.actual
        )
      ),
      [
        {
          x: 0,
          y: 90
        },
        {
          x: 250,
          y: 20
        }
      ]
    );


    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          throttle.reference
        )
      ),
      [
        {
          x: 0,
          y: 85
        },
        {
          x: 400,
          y: 10
        }
      ]
    );


    assert.equal(
      throttle.nowX,
      250
    );


    /*
     * Actual-only authority must suppress reference
     * rendering even if malformed/stale reference data
     * happens to be present in the object.
     */
    const actualOnly =
      renderer.buildGeometry!(
        {
          ...snapshot,
          state: "actual-only"
        },
        "brake",
        400,
        100
      );


    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          actualOnly.reference
        )
      ),
      []
    );


    /*
     * Invalid data must fail closed instead of producing
     * NaN / Infinity coordinates in Canvas.
     */
    const invalid =
      renderer.buildGeometry!(
        {
          state: "actual-only",
          actual: [
            {
              offsetMs: -100,
              brake: Number.NaN,
              throttle: 0.5
            },
            {
              offsetMs: 0,
              brake: 0.5,
              throttle: Number.POSITIVE_INFINITY
            }
          ],
          reference: []
        },
        "throttle",
        400,
        100
      );


    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          invalid.actual
        )
      ),
      []
    );


    /*
     * app.js owns cadence and the renderer owns drawing.
     * There must still be only one WebSocket.
     */
    assert.equal(
      (
        app.match(
          /new WebSocket/g
        ) ?? []
      ).length,
      1
    );


    assert.match(
      app,
      /apexPedalGraph\.draw/,
      "render queue must delegate Canvas drawing to the dedicated renderer"
    );


    assert.match(
      app,
      /PEDAL_GRAPH_MIN_FRAME_MS/,
      "render queue must expose an explicit maximum cadence"
    );


    assert.match(
      app,
      /1000\s*\/\s*30/,
      "pedal graph rendering must be capped at approximately 30 FPS"
    );


    /*
     * The standalone renderer itself must not create
     * timers, sockets, or an independent animation loop.
     */
    assert.doesNotMatch(
      source,
      /new WebSocket/
    );


    assert.doesNotMatch(
      source,
      /setInterval/
    );


    assert.doesNotMatch(
      source,
      /setTimeout/
    );


    assert.doesNotMatch(
      source,
      /requestAnimationFrame/
    );
  }
);