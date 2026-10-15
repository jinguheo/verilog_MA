#!/usr/bin/env bash
# vvirt MCP server (stdio). Needs the vvirt server running. See src/vvirt/mcp_server.py.
exec bash "$(dirname "$0")/pyrun.sh" -m vvirt.mcp_server "$@"
