const http = require("node:http");
const { classifyWebhook } = require("./extractors");
const { dispatchProjectStatusChange, resolveIssueFromNodeId } = require("./dispatch");

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

function createLogger(baseLogger = console) {
  const log = typeof baseLogger.log === "function" ? baseLogger.log.bind(baseLogger) : console.log.bind(console);
  return {
    log,
    info: typeof baseLogger.info === "function" ? baseLogger.info.bind(baseLogger) : log,
    warn: typeof baseLogger.warn === "function" ? baseLogger.warn.bind(baseLogger) : log,
    error: typeof baseLogger.error === "function" ? baseLogger.error.bind(baseLogger) : console.error.bind(console)
  };
}

function resolveEventType(template, { projectStatus, issueNumber, repositoryName }) {
  return template
    .replace(/\{status\}/g, (projectStatus || "unknown").replace(/\s+/g, "_").toLowerCase())
    .replace(/\{issue\}/g, String(issueNumber || 0))
    .replace(/\{repo\}/g, (repositoryName || "unknown").toLowerCase());
}

function createRequestHandler(config, dependencies = {}) {
  const dispatch = dependencies.dispatchProjectStatusChange || dispatchProjectStatusChange;
  const resolveIssue = dependencies.resolveIssueFromNodeId || resolveIssueFromNodeId;
  const logger = createLogger(dependencies.logger || console);

  return async (request, response) => {
    logger.log("Incoming request", {
      method: request.method,
      url: request.url,
      githubEvent: request.headers["x-github-event"],
      contentType: request.headers["content-type"]
    });

    if (request.method === "GET" && request.url === "/health") {
      logger.info("Health check served");
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method !== "POST" || request.url !== "/webhook") {
      logger.warn("Request not matched", {
        method: request.method,
        url: request.url
      });
      writeJson(response, 404, { status: "not_found" });
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request);
      logger.log("Webhook received", {
        method: request.method,
        url: request.url,
        githubEvent: request.headers["x-github-event"],
        action: payload.action,
        contentType: payload.content_type
      });
    } catch (error) {
      logger.error("Failed to parse webhook payload", { error: error.message });
      writeJson(response, 400, {
        status: "rejected",
        reason: error.message
      });
      return;
    }

    const result = classifyWebhook(request.headers, payload);
    if (result.status === "ignored") {
      logger.info("Webhook ignored", result);
      writeJson(response, 200, result);
      return;
    }

    if (result.status === "rejected") {
      logger.warn("Webhook rejected", result);
      writeJson(response, 422, result);
      return;
    }

    let resolvedIssue;
    if (result.status === "resolve") {
      logger.log("Resolving issue from content_node_id", {
        contentNodeId: result.contentNodeId
      });
      try {
        resolvedIssue = await resolveIssue({
          ghBin: config.ghBin,
          nodeId: result.contentNodeId
        });
      } catch (error) {
        logger.error("Webhook issue resolution failed", {
          error: error.message,
          contentNodeId: result.contentNodeId
        });

        writeJson(response, 502, {
          status: "failed",
          reason: error.message
        });
        return;
      }
    }

    const repositoryName = resolvedIssue?.repositoryName || result.repositoryName;
    const repositoryNameWithOwner = resolvedIssue?.repositoryNameWithOwner || result.repositoryNameWithOwner;
    const issueNumber = resolvedIssue?.issueNumber || result.issueNumber;

    if (!repositoryNameWithOwner) {
      logger.error("Webhook forwarding failed", {
        error: "Missing full repository nameWithOwner for dispatch",
        repositoryName,
        issueNumber
      });

      writeJson(response, 422, {
        status: "rejected",
        reason: "Missing full repository nameWithOwner for dispatch"
      });
      return;
    }

    try {
      logger.log("Dispatching repository event", {
        endpoint: `repos/${repositoryNameWithOwner}/dispatches`,
        repositoryNameWithOwner,
        repositoryName,
        issueNumber,
        projectStatus: result.projectStatus
      });

      const eventType = resolveEventType(config.eventType, {
        projectStatus: result.projectStatus,
        issueNumber,
        repositoryName
      });

      const dispatchPayload = await dispatch({
        ghBin: config.ghBin,
        eventType,
        repositoryNameWithOwner,
        issueNumber,
        projectStatus: result.projectStatus
      });

      logger.info("Webhook forwarded", {
        repositoryName,
        issueNumber,
        projectStatus: result.projectStatus
      });

      writeJson(response, 202, {
        status: "forwarded",
        repositoryName,
        repositoryNameWithOwner,
        issueNumber,
        projectStatus: result.projectStatus,
        dispatchPayload: dispatchPayload.payload || dispatchPayload,
        dispatchEndpoint: dispatchPayload.endpoint,
        resolvedIssue
      });
    } catch (error) {
      logger.error("Webhook forwarding failed", {
        error: error.message,
        repositoryNameWithOwner,
        repositoryName,
        issueNumber
      });

      writeJson(response, 502, {
        status: "failed",
        reason: error.message
      });
    }
  };
}

function createServer(config, dependencies = {}) {
  return http.createServer(createRequestHandler(config, dependencies));
}

module.exports = {
  createRequestHandler,
  createServer
};
