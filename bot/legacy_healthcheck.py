#!/usr/bin/env python3
"""Only the v0.4 Compose health probe is accepted; this is not a JS runtime."""

import sys
import urllib.request

PROBE = "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
if sys.argv[1:] != ["-e", PROBE]:
    raise SystemExit("Legacy node shim accepts only the v0.4 healthcheck")
try:
    with urllib.request.urlopen("http://127.0.0.1:3000/healthz", timeout=3) as response:
        raise SystemExit(0 if response.status == 200 else 1)
except OSError:
    raise SystemExit(1)
