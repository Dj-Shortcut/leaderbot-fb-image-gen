# Manus Debug Collector

This directory contains the `debug-collector.js` artifact created by Manus.

## Purpose
The `debug-collector.js` file is an advanced observability tool used for AI-driven debugging. It collects browser logs, network requests, and session events and sends them to a local endpoint for storage and analysis.

## Production Status
**This file is NOT part of the production application.** It has been intentionally isolated from the `client/public` directory to ensure it is not shipped as a public static asset.

## Usage
To use this script manually during development:
1. Copy the file to a location accessible by your development server (e.g., `client/public/__manus__/`).
2. Ensure the Vite plugin or equivalent backend endpoint is active to receive logs.
3. Add a `<script src="/__manus__/debug-collector.js" defer></script>` tag to your HTML.

## Design Constraints
- **No App Imports**: This file intentionally has no imports from the main application to maintain strict isolation and prevent circular dependencies or accidental inclusion in production bundles.
- **Isolated Execution**: It is designed to run as a standalone script in the browser environment.
