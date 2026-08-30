function isEpipe(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    error.code === "EPIPE"
  );
}

function writeBridgeDiagnostic(sink, message) {
  if (
    sink.destroyed === true ||
    sink.writableEnded === true ||
    sink.writable === false
  ) {
    return false;
  }

  let cleanupScheduled = false;
  const cleanup = () => {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    sink.removeListener?.("error", onError);
  };
  const onError = error => {
    cleanup();
    if (isEpipe(error)) return;
    throw error;
  };

  sink.once?.("error", onError);

  try {
    sink.write(message, error => {
      setImmediate(cleanup);
      if (!error || isEpipe(error)) return;
      throw error;
    });
    return true;
  }
  catch (error) {
    cleanup();
    if (isEpipe(error)) return false;
    throw error;
  }
}

module.exports = {
  writeBridgeDiagnostic
};
