#!/usr/bin/env bash
# Smoke test against a running Launchpad (default http://localhost:3100).
# With the fake Harakumo stub: node scripts/fake-harakumo.mjs & then start the app with
# HARAKUMO_URL=http://localhost:4010 HARAKUMO_API_KEY=hk_live_fake HARAKUMO_PROJECT_ID=1 LAUNCHPAD_OPERATOR_TOKEN=test-operator-token-123456
set -u
B=${BASE_URL:-http://localhost:3100}; J='content-type: application/json'; A="authorization: Bearer ${OPERATOR_TOKEN:-test-operator-token-123456}"
T=$(mktemp -d)
echo "--session"; curl -s $B/api/session; echo
echo "--plan (AI path)"; curl -s -X POST $B/api/assistant/plan -H "$J" -d '{"prompt":"My recipe app needs photo uploads and a database"}' > $T/p.json
python3 -c "import json;p=json.load(open('$T/p.json'))['plan'];print(p['planner'],'|',p['plannerDetail'],'|',[a['request']['name'] for a in p['actions']],'|',p['notes'])"
PID=$(python3 -c "import json;print(json.load(open('$T/p.json'))['plan']['id'])")
echo "--execute as visitor (expect simulated)"; curl -s -X POST $B/api/assistant/execute -H "$J" -d "{\"planId\":\"$PID\",\"approve\":true}" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['execution'],[r['operation']['status'] for r in d['results']])"
echo "--execute w/o approval (expect 400)"; curl -s -X POST $B/api/assistant/execute -H "$J" -d "{\"planId\":\"$PID\"}"; echo
echo "--plan + execute as operator (expect real)"; curl -s -X POST $B/api/assistant/plan -H "$J" -d '{"prompt":"Create a database and uploads storage for my recipes app."}' > $T/p2.json
PID2=$(python3 -c "import json;print(json.load(open('$T/p2.json'))['plan']['id'])")
curl -s -X POST $B/api/assistant/execute -H "$J" -H "$A" -d "{\"planId\":\"$PID2\",\"approve\":true}" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['execution'],d['plan']['status'],[(r['operation']['status'],r['resource'] and r['resource']['id'],r['error']) for r in d['results']])"
echo "--second database (expect plan_limit)"; curl -s -X POST $B/api/resources -H "$J" -H "$A" -d '{"type":"database","name":"launchpad-meta"}' | head -c 400; echo
echo "--vectors"; curl -s -X POST $B/api/resources -H "$J" -H "$A" -d '{"type":"vectors","name":"help-search","config":{"dimensions":384}}' | head -c 250; echo
echo "--function"; curl -s -X POST $B/api/resources -H "$J" -H "$A" -d '{"type":"function","name":"health-api","config":{"template":"echo"}}' | head -c 250; echo
echo "--list"; curl -s $B/api/resources | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['mode'],[(r['type'],r['id'],r['name'],r['status']) for r in d['resources']],d['errors'])"
echo "--secret leak check (expect 0)"; curl -s $B/api/resources | grep -c -i "connection_string\|SECRET"
echo "--ops"; curl -s "$B/api/operations?limit=10" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['store'],[(o['resourceName'],o['status'],o['execution'],o['errorCode']) for o in d['operations']])"
echo "--bad operator token (expect 401)"; curl -s -X POST $B/api/session -H "$J" -d '{"token":"wrong-token-wrong-token"}'; echo
