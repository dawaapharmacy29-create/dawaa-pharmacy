# Biometric attendance integration

This document describes the contract for the external fingerprint attendance desktop application.

## Endpoint

`POST https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/attendance-ingest`

## Authentication

Send the integration token in this header:

`x-dawaa-attendance-key: <integration-token>`

Do not send a Supabase service-role key from the desktop application.

## Accepted payload

The endpoint accepts either one event object, an array of events, or `{ "events": [...] }` with up to 500 events per request.

Recommended event shape:

```json
{
  "event_id": "optional-vendor-event-id",
  "device_id": "terminal-or-device-id",
  "employee_code": "123",
  "employee_name": "Employee name",
  "event_time": "2026-08-25 09:02:01",
  "event_type": "check_in",
  "branch": "فرع الشامي"
}
```

Required values are an employee/biometric identifier and an event timestamp. Common aliases are accepted by the endpoint.

Recommended values for `event_type` are `check_in` and `check_out`. Raw/unknown event types are preserved in the biometric log but are not promoted to the final staff attendance log until classified.

## Branches

The primary fingerprint integration client is currently limited to:

- فرع الشامي
- فرع شكري

## Response

Typical response:

```json
{
  "ok": true,
  "accepted": 1,
  "duplicates": 0,
  "rejected": 0,
  "errors": [],
  "server_time": "2026-08-30T00:00:00.000Z"
}
```

Repeated identical events are deduplicated server-side.

## Data flow

1. Vendor desktop app posts fingerprint events to `attendance-ingest`.
2. Raw events are stored in `biometric_attendance_logs`.
3. The database maps the biometric employee identifier to a Dawaa staff account when a mapping is available (or when it matches the account staff code fallback).
4. Classified `check_in` / `check_out` events are promoted to `staff_attendance_logs` and linked to their source biometric log.
