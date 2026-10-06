/**
 * Liquid template stored as Kuma's webhook custom body (Kuma 2.5 uses liquidjs ~10.26).
 *
 * `monitorJSON` is never interpolated as a whole: it contains HTTP headers and
 * the Postgres connection string. Each string field goes through liquidjs's
 * `json` filter, which is JSON.stringify, so quotes, newlines and backslashes
 * cannot break the document.
 *
 * heartbeatJSON.status is numeric: 0 down, 1 up. Anything else (pending,
 * maintenance) is "unknown". A notification test has no heartbeat; that branch
 * still emits valid JSON and is not used for paging.
 */
export const KUMA_WEBHOOK_BODY = `{% if heartbeatJSON %}
{% assign statusWord = "unknown" %}
{% if heartbeatJSON.status == 1 %}{% assign statusWord = "up" %}{% elsif heartbeatJSON.status == 0 %}{% assign statusWord = "down" %}{% endif %}
{% assign monitorName = "" %}
{% assign monitorType = "" %}
{% if monitorJSON %}{% assign monitorName = monitorJSON.name %}{% assign monitorType = monitorJSON.type %}{% endif %}
{
  "source": "uptime-kuma",
  "version": 1,
  "alert": "heartbeat",
  "status": {{ statusWord | json }},
  "monitor": {{ monitorName | json }},
  "type": {{ monitorType | json }},
  "message": {{ heartbeatJSON.msg | json }},
  "time": {{ heartbeatJSON.time | json }},
  "important": {{ heartbeatJSON.important | json }},
  "pingMs": {{ heartbeatJSON.ping | json }}
}
{% else %}
{
  "source": "uptime-kuma",
  "version": 1,
  "alert": "heartbeat",
  "status": "test",
  "monitor": {{ name | json }},
  "type": null,
  "message": {{ msg | json }},
  "time": null,
  "important": false,
  "pingMs": null
}
{% endif %}`;
