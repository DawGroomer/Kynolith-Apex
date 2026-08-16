import { startCoachServer } from "./server.js";

startCoachServer()
  .then(running => {
    console.log(`Kynolith LMU Coach: http://127.0.0.1:${running.port}`);
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
