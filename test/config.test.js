const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

test("loads config from the provided environment object", () => {
  const config = loadConfig({
    PORT: "4010",
    GITHUB_EVENT_TYPE: "project_status_change",
    GH_BIN: "/usr/local/bin/gh"
  });

  assert.deepEqual(config, {
    port: 4010,
    eventType: "project_status_change",
    ghBin: "/usr/local/bin/gh"
  });
});

test("uses defaults when optional values are missing", () => {
  assert.deepEqual(loadConfig({}), {
    port: 3000,
    eventType: "issue_{issue}_{status}_{repo}",
    ghBin: "gh"
  });
});
