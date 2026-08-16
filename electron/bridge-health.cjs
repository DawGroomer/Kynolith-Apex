const DISCONNECT_TIMEOUT_MS = 2500;
const RESTART_TIMEOUT_MS = 15000;

function evaluateBridgeHealth({
  now,
  lastFrameAt,
  disconnectReported
}) {
  if (!lastFrameAt) {
    return {
      disconnect: false,
      restart: false
    };
  }

  const age = now - lastFrameAt;

  return {
    disconnect: age > DISCONNECT_TIMEOUT_MS && !disconnectReported,
    restart: age > RESTART_TIMEOUT_MS
  };
}

module.exports = {
  evaluateBridgeHealth
};
