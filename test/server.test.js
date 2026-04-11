const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { createRequestHandler } = require("../src/server");

async function invokeHandler({ method, url, headers, body }, overrides = {}) {
  const forwarded = [];
  const resolved = [];
  const handler = createRequestHandler(
    {
      eventType: "issue_{issue}_{status}_{repo}",
      ghBin: "gh"
    },
    {
      logger: {
        log() {},
        info() {},
        warn() {},
        error() {}
      },
      dispatchProjectStatusChange: async (payload) => {
        forwarded.push(payload);
        return {
          endpoint: `repos/${payload.repositoryNameWithOwner}/dispatches`,
          event_type: payload.eventType,
          client_payload: {
            issue_number: payload.issueNumber,
            project_status: payload.projectStatus,
            target_repo: payload.repositoryNameWithOwner
          }
        };
      },
      resolveIssueFromNodeId: async ({ nodeId }) => {
        resolved.push(nodeId);
        return {
          issueNumber: 123,
          repositoryName: "repo",
          repositoryNameWithOwner: "owner/repo",
          title: "Example issue",
          url: "https://github.com/owner/repo/issues/123"
        };
      },
      ...overrides
    }
  );

  const request = Readable.from(body ? [body] : []);
  request.method = method;
  request.url = url;
  request.headers = headers || {};

  const chunks = [];
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });

  response.statusCode = 200;
  response.headers = {};
  response.writeHead = (statusCode, headersObject) => {
    response.statusCode = statusCode;
    response.headers = headersObject;
  };
  response.end = (chunk) => {
    if (chunk) {
      chunks.push(Buffer.from(chunk));
    }
    response.body = Buffer.concat(chunks).toString("utf8");
    response.finished = true;
  };

  await handler(request, response);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body ? JSON.parse(response.body) : undefined,
    forwarded,
    resolved
  };
}

test("forwards a valid projects_v2_item webhook", async () => {
  const response = await invokeHandler({
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-github-event": "projects_v2_item"
    },
    body: JSON.stringify({
      action: "edited",
      content: {
        number: 11,
        repository: {
          full_name: "medimohammadise/elegant-ci-cd-pipeline",
          name: "elegant-ci-cd-pipeline"
        }
      },
      changes: {
        field_value: {
          to: {
            name: "In Progress"
          }
        }
      }
    })
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.status, "forwarded");
  assert.equal(response.body.repositoryName, "elegant-ci-cd-pipeline");
  assert.equal(response.body.repositoryNameWithOwner, "medimohammadise/elegant-ci-cd-pipeline");
  assert.equal(response.body.issueNumber, 11);
  assert.equal(response.body.projectStatus, "In Progress");
  assert.equal(response.forwarded.length, 1);
  assert.deepEqual(response.forwarded[0], {
    ghBin: "gh",
    eventType: "issue_11_in_progress_elegant-ci-cd-pipeline",
    repositoryNameWithOwner: "medimohammadise/elegant-ci-cd-pipeline",
    issueNumber: 11,
    projectStatus: "In Progress"
  });
});

test("rejects a projects_v2_item webhook when required routing data is missing", async () => {
  const response = await invokeHandler({
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-github-event": "projects_v2_item"
    },
    body: JSON.stringify({
      action: "edited",
      changes: {
        field_value: {
          to: {
            name: "In Progress"
          }
        }
      }
    })
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.status, "rejected");
  assert.equal(response.forwarded.length, 0);
});

test("resolves issue repository from content_node_id before dispatching", async () => {
  const response = await invokeHandler({
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-github-event": "projects_v2_item"
    },
    body: JSON.stringify({
      action: "edited",
      content_type: "Issue",
      content_node_id: "I_kwDOP71PU875Rcmj",
      changes: {
        field_value: {
          to: {
            name: "In Progress"
          }
        }
      }
    })
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.resolved, ["I_kwDOP71PU875Rcmj"]);
  assert.equal(response.body.status, "forwarded");
  assert.equal(response.body.repositoryName, "repo");
  assert.equal(response.body.repositoryNameWithOwner, "owner/repo");
  assert.equal(response.body.issueNumber, 123);
  assert.deepEqual(response.body.resolvedIssue, {
    issueNumber: 123,
    repositoryName: "repo",
    repositoryNameWithOwner: "owner/repo",
    title: "Example issue",
    url: "https://github.com/owner/repo/issues/123"
  });
  assert.deepEqual(response.forwarded[0], {
    ghBin: "gh",
    eventType: "issue_123_in_progress_repo",
    repositoryNameWithOwner: "owner/repo",
    issueNumber: 123,
    projectStatus: "In Progress"
  });
});

test("returns 502 when content_node_id resolution fails", async () => {
  const response = await invokeHandler(
    {
      method: "POST",
      url: "/webhook",
      headers: {
        "content-type": "application/json",
        "x-github-event": "projects_v2_item"
      },
      body: JSON.stringify({
        action: "edited",
        content_type: "Issue",
        content_node_id: "I_kwDOP71PU875Rcmj",
        changes: {
          field_value: {
            to: {
              name: "In Progress"
            }
          }
        }
      })
    },
    {
      resolveIssueFromNodeId: async () => {
        throw new Error("GitHub GraphQL response did not include a node");
      }
    }
  );

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.status, "failed");
  assert.match(response.body.reason, /did not include a node/);
});

test("ignores unrelated webhook events", async () => {
  const response = await invokeHandler({
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues"
    },
    body: JSON.stringify({
      action: "opened"
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ignored");
  assert.equal(response.forwarded.length, 0);
});

test("returns a health response", async () => {
  const response = await invokeHandler({
    method: "GET",
    url: "/health",
    headers: {}
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ok" });
});
