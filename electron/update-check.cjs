const UPDATE_CHECK_URL =
  "https://api.github.com/repos/DawGroomer/Kynolith-Apex/releases/latest";

const RELEASE_BASE_URL =
  "https://github.com/DawGroomer/Kynolith-Apex/releases/tag/";

function normalizeVersion(value) {
  const version = String(value ?? "").trim().replace(/^v/i, "");

  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) {
    return null;
  }

  return version;
}

function compareSemver(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);

  if (!left || !right) return 0;

  const aParts = left.split(".").map(Number);
  const bParts = right.split(".").map(Number);
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aValue = aParts[i] ?? 0;
    const bValue = bParts[i] ?? 0;

    if (aValue > bValue) return 1;
    if (aValue < bValue) return -1;
  }

  return 0;
}

async function checkForUpdate({
  enabled,
  currentVersion,
  fetchImpl = globalThis.fetch
}) {
  if (enabled !== true) {
    return {
      status: "disabled"
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      status: "unavailable"
    };
  }

  try {
    const response = await fetchImpl(
      UPDATE_CHECK_URL,
      {
        headers: {
          "User-Agent": "KynolithApexUpdateChecker",
          "Accept": "application/vnd.github+json"
        }
      }
    );

    if (!response?.ok) {
      return {
        status: "unavailable"
      };
    }

    const release = await response.json();

    if (release?.prerelease === true) {
      return {
        status: "current"
      };
    }

    const tag = String(
      release?.tag_name ?? release?.name ?? ""
    ).trim();

    const latestVersion = normalizeVersion(tag);
    const installedVersion = normalizeVersion(currentVersion);

    if (
      !latestVersion ||
      !installedVersion ||
      compareSemver(latestVersion, installedVersion) <= 0
    ) {
      return {
        status: "current"
      };
    }

    const releaseTag = tag.startsWith("v")
      ? tag
      : `v${latestVersion}`;

    return {
      status: "available",
      version: latestVersion,
      url: `${RELEASE_BASE_URL}${encodeURIComponent(releaseTag)}`
    };
  }
  catch {
    return {
      status: "unavailable"
    };
  }
}

module.exports = {
  UPDATE_CHECK_URL,
  compareSemver,
  checkForUpdate
};
