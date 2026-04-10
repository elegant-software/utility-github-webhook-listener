# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Webhook receiver that accepts GitHub `projects_v2_item` events and forwards project status changes as repository dispatch events. Uses the GitHub CLI (`gh`) for GraphQL queries and REST API calls -- no GitHub SDK or token management in the app itself.

## Commands

- **Start server:** `npm start`
- **Run all tests:** `npm test`
- **Run a single test file:** `node --test test/server.test.js`

## Architecture

Plain Node.js (>=20) HTTP server with no frameworks or external dependencies. Uses the built-in `node:test` runner and `node:assert/strict`.

**Request flow:** `index.js` loads config and starts the server. `server.js` handles HTTP routing (`POST /webhook` and `GET /health`). For webhooks, `extractors.js` classifies the payload into one of three statuses:
- `forward` -- issue number and repo are present, dispatch immediately
- `resolve` -- only a `content_node_id` is available, resolve the issue via GitHub GraphQL first, then dispatch
- `rejected`/`ignored` -- missing data or non-actionable event

`dispatch.js` shells out to the `gh` CLI (`gh api`) for both GraphQL issue resolution and REST repository dispatch calls.

**Dependency injection:** `createRequestHandler(config, dependencies)` accepts optional `dispatchProjectStatusChange`, `resolveIssueFromNodeId`, and `logger` overrides. Tests use this to stub the `gh` CLI calls and silence logs.

## Key Conventions

- CommonJS modules (`require`/`module.exports`), not ESM.
- No external npm dependencies -- stdlib only.
- Config is read from environment variables via `config.js` (`PORT`, `GITHUB_EVENT_TYPE`, `GH_BIN`).
- Extractor functions use a `firstDefined(payload, candidatePaths)` pattern to probe multiple possible payload shapes for the same field (GitHub webhook payloads vary).