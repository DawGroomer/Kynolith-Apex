import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";


test(
  "HUD exposes dedicated pedal graph canvases and consumes the live pedalGraph payload",
  () => {
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


    const css =
      readFileSync(
        "public/hud.css",
        "utf8"
      );


    const throttleCard =
      html.match(
        /<article[^>]*data-hud-field="throttle"[\s\S]*?<\/article>/
      )?.[0];


    const brakeCard =
      html.match(
        /<article[^>]*data-hud-field="brake"[\s\S]*?<\/article>/
      )?.[0];


    assert.ok(
      throttleCard,
      "throttle HUD card must exist"
    );


    assert.ok(
      brakeCard,
      "brake HUD card must exist"
    );


    assert.match(
      throttleCard,
      /<canvas[^>]*id="hudThrottleGraph"/,
      "throttle HUD card must expose its dedicated graph canvas"
    );


    assert.match(
      brakeCard,
      /<canvas[^>]*id="hudBrakeGraph"/,
      "brake HUD card must expose its dedicated graph canvas"
    );


    assert.match(
      throttleCard,
      /id="hudThrottleValue"/,
      "throttle HUD card must retain a current percentage value"
    );


    assert.match(
      brakeCard,
      /id="hudBrakeValue"/,
      "brake HUD card must retain a current percentage value"
    );


    /*
     * These HUD cards are becoming graphs, not bars
     * with canvases stacked on top as a cosmetic patch.
     */
    assert.doesNotMatch(
      throttleCard,
      /hud-bar/,
      "throttle HUD graph must replace the old fill bar"
    );


    assert.doesNotMatch(
      brakeCard,
      /hud-bar/,
      "brake HUD graph must replace the old fill bar"
    );


    /*
     * The existing WebSocket remains the single owner
     * of live browser telemetry.
     */
    assert.equal(
      (
        app.match(
          /new WebSocket/g
        ) ?? []
      ).length,
      1,
      "pedal rendering must not create another WebSocket"
    );


    assert.match(
      app,
      /queuePedalGraphRender\(m\.pedalGraph\)/,
      "the existing /live handler must pass pedalGraph to the renderer queue"
    );


    assert.equal(
      (
        app.match(
          /function queuePedalGraphRender/g
        ) ?? []
      ).length,
      1,
      "pedal graph rendering must have one queue owner"
    );


    /*
     * Current percentages remain telemetry values;
     * graph rendering does not replace the at-a-glance
     * numeric input indication.
     */
    assert.match(
      app,
      /\$\("hudThrottleValue"\)\.textContent/,
      "HUD renderer must update throttle percentage"
    );


    assert.match(
      app,
      /\$\("hudBrakeValue"\)\.textContent/,
      "HUD renderer must update brake percentage"
    );


    /*
     * Reserve dedicated HUD graph styling instead of
     * mutating the generic desktop input bars.
     */
    assert.match(
      css,
      /\.hud-pedal-canvas/,
      "HUD graph canvas must have dedicated styling"
    );


    assert.match(
      css,
      /\.hud-input-value/,
      "HUD graph percentage must have dedicated styling"
    );


    /*
     * Browser source must remain syntactically valid.
     */
    execFileSync(
      process.execPath,
      [
        "--check",
        "public/app.js"
      ],
      {
        stdio: "pipe"
      }
    );
  }
);