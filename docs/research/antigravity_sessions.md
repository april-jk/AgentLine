# AntiGravity Session Storage Findings

## Overview
Investigation into discrepancies between AgentLine session visibility and AntiGravity storage.

## Findings

### 1. Storage Location
*   **AgentLine**: Scans `~/.gemini/tmp` (specifically project hash directories).
*   **AntiGravity**: Stores sessions in `~/.gemini/antigravity/conversations`.

### 2. File Format
*   **AgentLine**: Expects JSON files (`session-*.json`) with a specific schema.
*   **AntiGravity**: Uses Protocol Buffers (`*.pb`) with UUID filenames.

## Conclusion
AgentLine does not currently support AntiGravity sessions due to mismatches in both storage location and file format (JSON vs Protobuf).
