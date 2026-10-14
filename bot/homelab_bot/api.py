from __future__ import annotations

import json
import re
from urllib.parse import quote, urlencode

import aiohttp


def safe_error(value, secrets=()):
    text = str(value)
    for secret in secrets:
        if secret and len(secret) > 3:
            text = text.replace(secret, "[redacted]")
    text = re.sub(r"https?://[^\s<>]+", "[endpoint]", text)
    text = re.sub(
        r"(?i)\b(token|password|secret|api[_-]?key)(\s*[=:]\s*)[^\s,;]+", r"\1\2[redacted]", text
    )
    text = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "[address]", text)
    return text.replace("@", "＠").replace("`", "'")[:1000]


class Agent:
    def __init__(self, cfg, session):
        self.cfg, self.session = cfg, session

    async def request(self, path, *, method="GET", body=None, user=None, timeout=20):
        headers = {"X-Homelab-Control-Token": self.cfg.control_token}
        if user:
            headers.update(
                {"X-Discord-User-ID": str(user.id), "X-Discord-User-Name": str(user.name)[:100]}
            )
        try:
            async with self.session.request(
                method,
                self.cfg.agent_url + path,
                json=body,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
                allow_redirects=False,
            ) as response:
                payload = await response.json(content_type=None)
                if (
                    response.status >= 300
                    or not isinstance(payload, dict)
                    or payload.get("ok") is False
                ):
                    detail = payload.get("error") if isinstance(payload, dict) else None
                    raise ValueError(
                        safe_error(
                            detail or f"Controller HTTP {response.status}",
                            (self.cfg.control_token,),
                        )
                    )
                return payload.get("data", payload)
        except TimeoutError as exc:
            raise ValueError(
                "The controller request timed out. Refresh to see its current status."
            ) from exc
        except (aiohttp.ClientError, json.JSONDecodeError) as exc:
            raise ValueError(
                "The controller could not be reached. Try Refresh after it returns online."
            ) from exc

    async def get(self, name, refresh=False, channel=""):
        allowed = {
            "status",
            "services",
            "control-policy",
            "media",
            "media-summary",
            "network",
            "network-summary",
            "network-connectivity",
            "ping",
            "minecraft",
            "sessions",
            "jellyfin",
            "plex",
            "media-resources",
            "tasks",
            "updates",
            "system-updates",
            "audit",
        }
        if name not in allowed:
            raise ValueError("Unsupported controller reader")
        query = {"refresh": "1"} if refresh else {}
        if channel in {"stable", "beta"}:
            query["channel"] = channel
        return await self.request(
            "/v1/" + name + ("?" + urlencode(query) if query else ""),
            timeout=50 if name == "tasks" else 35,
        )

    async def post(self, name, user, body=None, timeout=30):
        return await self.request(
            "/v1/" + name, method="POST", body=body, user=user, timeout=timeout
        )

    async def action(self, key, action, user):
        if action not in {"start", "stop", "restart", "backup"}:
            raise ValueError("Unsupported container action")
        return await self.post(f"services/{quote(key, safe='')}/{action}", user, timeout=120)

    async def logs(self, key):
        return await self.request(f"/v1/logs/{quote(key, safe='')}?tail=35")


async def optional(coro, default=None):
    try:
        return await coro
    except (TimeoutError, ValueError, aiohttp.ClientError):
        return default
