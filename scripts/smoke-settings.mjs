import { startCoachServer } from "../dist/server.js";

const server = await startCoachServer({ port: 4388, dataDir: ".smoke-data" });
try {
  const current = await fetch("http://127.0.0.1:4388/api/settings").then(response => response.json());
  const settings = await fetch("http://127.0.0.1:4388/api/settings", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...current, speechFrequency: "active", voiceVolume: .65, controllerButton: 7 })
  }).then(response => response.json());
  const status = await fetch("http://127.0.0.1:4388/api/local/status").then(response => response.json());
  console.log(JSON.stringify({ settings, status }));
} finally { await server.close(); }
