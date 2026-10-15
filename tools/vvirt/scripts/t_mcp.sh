#!/usr/bin/env bash
# talk to the MCP server by hand: initialize, list, describe, run SKILL, run a bad call
ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"vvirt_describe","arguments":{"name":"vvRoute"}}}' \
 '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"vvirt_skill","arguments":{"code":"vvGet(vvCellInfo(\"sky130_fd_sc_hd__inv_1\") \"width\")"}}}' \
 '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"vvirt_skill","arguments":{"code":"nosuchfn(1)"}}}' \
 '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"vvirt_skill","arguments":{}}}' \
 | bash $ROOT/scripts/mcp.sh | python3 -c "
import sys, json
for line in sys.stdin:
    m = json.loads(line)
    r = m.get('result', m.get('error'))
    if 'tools' in (r or {}): print(m['id'], 'tools:', [t['name'] for t in r['tools']])
    elif 'content' in (r or {}): print(m['id'], 'isError=%s' % r['isError'], '|', r['content'][0]['text'][:110].replace(chr(10), ' / '))
    else: print(m['id'], json.dumps(r)[:140])
"
