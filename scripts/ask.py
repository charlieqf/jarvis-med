"""Command-line client for the live answer API (for testing on the server host).

Usage: python3 scripts/ask.py "问题" [base_url]
Reads the access code from ~/.jarvis/access_code. Prints every server event with its time.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

q = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8787"
code = (Path.home() / ".jarvis" / "access_code").read_text().strip()
req = urllib.request.Request(f"{base}/api/ask", data=json.dumps({"question": q}).encode(),
                             headers={"content-type": "application/json", "x-access-code": code}, method="POST")
job = json.load(urllib.request.urlopen(req))["jobId"]
after, t0 = -1, time.time()
while time.time() - t0 < 240:
    d = json.load(urllib.request.urlopen(f"{base}/api/job/{job}?after={after}"))
    for e in d["events"]:
        after = e["n"]
        print(f"{e['t'] / 1000:6.1f}s {e['kind']:13} {(e.get('status') or ''):9} {e['text'][:170]}", flush=True)
    if d["done"]:
        break
    time.sleep(0.5)
