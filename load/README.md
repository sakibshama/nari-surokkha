# Load tests

Every capacity figure in `PERFORMANCE_SCALABILITY_RATING_v2.md` is an estimate
derived from reading code. These scripts replace the estimates with numbers.

## Why these three

The system's defining characteristic is **simultaneous emergency spikes** — an
incident does not produce one SOS, it produces a burst. The three scenarios
mirror the three ways that load actually arrives:

| Script | Models | Answers |
|---|---|---|
| `sos-spike.js` | many people press the button at once | Does the panic button stay fast under a burst? |
| `location-soak.js` | many alerts streaming position for a long time | Does the write path hold up over hours? |
| `ws-fanout.js` | many portals and phones connected at once | How many sockets does one instance hold? |

## Running

```bash
# Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
export BASE_URL=https://api.staging.example.com
export TEST_PHONE=+8801700000000
export TEST_PASSWORD='...'

k6 run load/sos-spike.js
k6 run load/location-soak.js
k6 run --vus 2000 load/ws-fanout.js
```

**Run these against staging, never production.** `sos-spike.js` creates real
alerts, which dispatch real responders and — if SMS is enabled — send real
messages to real trusted contacts. Set `SMS_PROVIDER=mock` on the target
environment first.

## Reading the results

Each script declares `thresholds` matching the SLOs in
`infra/monitoring/alerts.yml`, so a failing threshold here is the same
condition that would page someone in production. k6 exits non-zero when one is
breached, which makes these usable as a release gate in CI.

Watch Grafana while they run: `sos_dispatch_duration_seconds` and
`queue_depth` are the two that reveal whether the queue is draining as fast as
the burst arrives.
