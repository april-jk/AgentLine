# Remote File List: UI/API/Security Plan (2026-05-20)

## Scope
Add read-only remote file listing for a project, compatible with direct and relay modes.

## UI Design
- New route: `/projects/:projectId/files`
- Layout: left file tree list, right file preview (initially link to existing file viewer route)
- Interactions:
  - Lazy directory navigation by `path`
  - Breadcrumb-style current path
  - Directory-first sorting
  - Error states for 401/403/404/429/500
- Performance:
  - Server pagination with `limit` and `cursor`
  - "Load more" for large directories

## API Contract
- Endpoint: `GET /api/projects/:projectId/files/list`
- Query params:
  - `path` (optional, default `.`)
  - `limit` (optional, default 200, max 1000)
  - `cursor` (optional; entry name to continue after)
- Response:
  - `path: string`
  - `entries: Array<{ name: string; path: string; type: "file" | "directory"; size?: number; mtimeMs?: number }>`
  - `nextCursor: string | null`
  - `truncated: boolean`

## Security Controls
- Authn/Authz:
  - Reuse existing `/api/*` middleware and project lookup checks.
  - No anonymous exception.
- Path safety:
  - Reuse `resolveFilePath` to block traversal and absolute paths.
  - Reject paths outside project root.
- Enumeration control:
  - Cap `limit` and paginate.
  - Filter noisy/sensitive dirs by default: `.git`, `node_modules`, `dist`, `build`.
- Error hygiene:
  - Return generic API errors; never leak host absolute paths.

## Direct vs Relay
- Frontend calls same business endpoint in both modes.
- Relay only transports encrypted requests; authorization stays on host server.

## Test Plan
- Success:
  - root listing, subdirectory listing, pagination behavior.
- Security:
  - traversal `..`, absolute path, invalid project id.
- Behavior:
  - filtered directories excluded.
  - non-directory path rejected on list endpoint.

## Delivery Order
1. Backend endpoint + tests
2. Frontend page + routing
3. Manual smoke test in direct and relay routes
