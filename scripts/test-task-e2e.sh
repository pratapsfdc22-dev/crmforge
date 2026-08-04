#!/bin/bash
# End-to-end task queue test
# Enqueues a task via API and monitors it via SSE

set -e

API_URL="${API_URL:-http://localhost:4000}"
AUTH_TOKEN="${AUTH_TOKEN:-test-token}"

echo "[E2E Test] Starting task end-to-end test"
echo "[E2E Test] API URL: $API_URL"
echo ""

# Step 1: Enqueue a task
echo "[E2E Test] Step 1: Enqueuing task..."
RESPONSE=$(curl -s -X POST "$API_URL/tasks" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intent":"Find all open Jira issues assigned to me"}')

TASK_ID=$(echo "$RESPONSE" | jq -r '.taskId // empty')

if [ -z "$TASK_ID" ]; then
  echo "[E2E Test] ERROR: Failed to enqueue task"
  echo "$RESPONSE" | jq .
  exit 1
fi

echo "[E2E Test] ✓ Task enqueued: $TASK_ID"
echo ""

# Step 2: Monitor task via SSE
echo "[E2E Test] Step 2: Monitoring task progress via SSE..."
echo "[E2E Test] (Connect to: $API_URL/tasks/$TASK_ID/events)"
echo ""

# Stream events with 30 second timeout
timeout 30 curl -s -X GET "$API_URL/tasks/$TASK_ID/events" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Accept: text/event-stream" | while IFS= read -r line; do
  if [[ "$line" == data:* ]]; then
    # Extract JSON from SSE format
    json="${line#data: }"
    echo "[Event] $(echo "$json" | jq -c '.type // .type = "unknown"')"
    echo "$json" | jq '.type' | grep -q "completed\|failed" && break
  fi
done

echo ""
echo "[E2E Test] ✓ Task monitoring complete"
