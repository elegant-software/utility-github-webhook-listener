# Project Item Status Webhook

Webhook receiver that accepts GitHub `projects_v2_item` events and forwards project status changes as repository dispatch events.

## What It Does

- Exposes `POST /webhook` for incoming GitHub webhook deliveries.
- Exposes `GET /health` for a simple health check.
- Accepts GitHub `projects_v2_item` events only.
- Extracts the target repository, issue number, and project status from the webhook payload.
- Resolves issue details from `content_node_id` when the payload does not include direct repository or issue routing data.
- Sends a repository dispatch event to the resolved target repository.

## Dispatch Payload

Outgoing repository dispatch events use:

- Event type: `project_status_change` by default
- Client payload fields:
  - `issue_number`
  - `project_status`
  - `target_repo`

## Configuration

Environment variables:

- `PORT`: HTTP port, default `3000`
- `GITHUB_EVENT_TYPE`: repository dispatch event type, default `project_status_change`
- `GH_BIN`: GitHub CLI binary path, default `gh`

## CI/CD Workflows

Two workflows follow the consumer pipeline pattern you referenced in `blitz-pay`: a dedicated build pipeline and a dedicated deploy pipeline.

### Build container image (`.github/workflows/build.yml`)

- **Triggers**: `push` to `main`, `workflow_dispatch`, or `workflow_call` with overrides.
- **Steps**: checkout, install Node dependencies, run the test suite, build multi-arch images, and push them to the configured registry using the project `Dockerfile`.
- **Login**: the workflow uses `docker/login-action@v4` with `github.actor` and `secrets.GITHUB_TOKEN`, so you do not need dedicated registry credentials.
- **Secrets/inputs**:
  - `REGISTRY_URL`: optional registry host (defaults to `ghcr.io`).
  - `REGISTRY` input: optional registry override for login.
  - `IMAGE_REPOSITORY`: optional override for the built image repository (defaults to `ghcr.io/<owner>/<repo>`).
- **Outputs**: `image_reference` and `image_latest` are exported for downstream workflows.
- **Inline deploy trigger**: When `KUBE_CONFIG_DATA` is defined, the build workflow calls `.github/workflows/deploy.yml` to roll the freshly pushed image into the cluster automatically.

### Deploy to Kubernetes (`.github/workflows/deploy.yml`)

- **Triggers**: manual `workflow_dispatch` or `workflow_call` (used by the build workflow).
- **Inputs & secrets**: requires an `image_reference` input plus the `KUBE_CONFIG_DATA` secret (the `kubeconfig` must be base64-encoded in this secret). Optionally accepts `kube_namespace` (defaults to `default`) and uses `KUBE_NAMESPACE` repo secret if provided.
- **Steps**: install `kubectl`, import the kubeconfig, template `k8s/consumer-deployment.yaml` with `envsubst` (populating `${IMAGE}`), and apply the manifest in the target namespace.
- If `KUBE_CONFIG_DATA` is absent, the deploy workflow simply never runs.

### Kubernetes manifest (`k8s/consumer-deployment.yaml`)

- Describes a Deployment + ClusterIP Service for the webhook consumer. The container image is supplied via the `IMAGE` environment variable that the workflow replaces with the built image reference.
- The application listens on port 3000, expects `PORT`, `GITHUB_EVENT_TYPE`, and `GH_BIN`, and exposes HTTP traffic through the cluster service.
- **Image pull secret**: The Deployment references `ghcr-pull-secret`, which must store credentials that can read from GitHub Packages since the image is hosted on GHCR.
- **Ingress**: An Ingress resource exposes the service at `webhook-utils.elegantsoftware.de` with TLS backed by `wildcard-elegantsoftware-de-tls` and the required `cert-manager`/`nginx` annotations so the ingress controller can handle long-running webhook connections.

### Dockerfile support

- A lightweight multi-stage `Dockerfile` sits at the repository root so the build workflow can assemble the runtime image without needing an external Dockerfile. It copies the Node sources, installs production dependencies, and starts the service with `npm start`, so you can build, push, and deploy directly from this repository.

## Local Development

Start the service:

```bash
npm start
```

Run tests:

```bash
npm test
```

## Request Handling Rules

- `GET /health` returns `200` with `{ "status": "ok" }`
- Requests other than `POST /webhook` return `404`
- Non-`projects_v2_item` webhook events are ignored
- Project item events without a status change are ignored
- Events missing required routing data are rejected
- Valid status change events are forwarded and return `202`

## Logging And Debugging

The server writes logs to standard output and error through the runtime logger.

Current log points:

- `Incoming request`: emitted for every request before route matching
- `Health check served`: emitted for `GET /health`
- `Request not matched`: emitted for unsupported paths or methods
- `Webhook received`: emitted after a valid JSON body is parsed
- `Webhook ignored`: emitted when the event is not actionable
- `Webhook rejected`: emitted when required data is missing
- `Resolving issue from content_node_id`: emitted before GitHub issue lookup
- `Dispatching repository event`: emitted before repository dispatch
- `Webhook forwarded`: emitted after a successful dispatch
- `Webhook forwarding failed` / `Webhook issue resolution failed`: emitted on failures

If you do not see logs:

- Confirm the Node process is running in the foreground or that your process manager captures stdout/stderr.
- Confirm requests are actually reaching this service instance.
- Check whether you are hitting `/health`, `/webhook`, or a different path.
- Check whether the request body is valid JSON.
- Check whether the `x-github-event` header is set to `projects_v2_item`.

## Project Structure

- [src/index.js](/Users/mehdi/MyProject/project-item-status-webhook/src/index.js): process entrypoint
- [src/server.js](/Users/mehdi/MyProject/project-item-status-webhook/src/server.js): HTTP server and request handling
- [src/extractors.js](/Users/mehdi/MyProject/project-item-status-webhook/src/extractors.js): webhook classification and field extraction
- [src/dispatch.js](/Users/mehdi/MyProject/project-item-status-webhook/src/dispatch.js): GitHub CLI dispatch and issue resolution
- [test/server.test.js](/Users/mehdi/MyProject/project-item-status-webhook/test/server.test.js): request handling tests
