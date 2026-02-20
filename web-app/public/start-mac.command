#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  [ MacOptics v2.0 ]  Starting local server..."
echo ""

# Start server in background, wait 2s, open browser
python3 -m http.server 8080 &
SERVER_PID=$!
sleep 2
open "http://localhost:8080" 2>/dev/null || xdg-open "http://localhost:8080" 2>/dev/null

echo "  Server running at http://localhost:8080"
echo "  Press Ctrl+C to stop"
echo ""

# Keep server in foreground
wait $SERVER_PID
