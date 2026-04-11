function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    eventType: env.GITHUB_EVENT_TYPE || "issue_{issue}_{status}_{repo}",
    ghBin: env.GH_BIN || "gh"
  };
}

module.exports = {
  loadConfig
};
