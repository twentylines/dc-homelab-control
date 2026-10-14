from __future__ import annotations

import asyncio
import json
import ssl
from pathlib import Path
from urllib.parse import quote, urlsplit

import aiohttp

from .api import safe_error


def number(value):
    try:
        result = float(value)
        return result if 0 <= result < float("inf") else None
    except (ValueError, TypeError):
        return None


def resources(source):
    source = source or {}
    mapping = {
        "cpu_percent": ("cpu_absolute", "cpu_percent", "cpuUsage", "cpu"),
        "memory_used": ("memory_bytes", "memory_used", "memoryUsage", "memory", "ram"),
        "memory_limit": ("memory_limit_bytes", "memory_limit", "memoryLimit", "ram_limit"),
        "disk_used": ("disk_bytes", "disk_used", "diskUsage"),
        "network_rx": ("network_rx_bytes", "network_rx", "networkRx"),
        "network_tx": ("network_tx_bytes", "network_tx", "networkTx"),
        "pids": ("pids", "processes"),
    }
    result = {}
    for key, names in mapping.items():
        value = next((source[name] for name in names if source.get(name) is not None), None)
        numeric = number(value)
        if numeric is not None:
            result[key] = numeric
    return result


def crafty_tls(cfg):
    path = cfg.get("CRAFTY_CA_CERT_FILE")
    if cfg.get("CRAFTY_ALLOW_INSECURE_TLS").lower() == "true":
        return False
    if not path:
        return ssl.create_default_context()
    try:
        pem = Path(path).read_text()
        if "PRIVATE KEY" in pem or "-----BEGIN CERTIFICATE-----" not in pem:
            raise ValueError("Crafty trust file must contain public PEM certificates only")
        context = ssl.create_default_context(cadata=pem)
        context.verify_flags |= getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0)
        return context
    except OSError as exc:
        raise ValueError("Crafty public certificate file cannot be read") from exc


class Minecraft:
    def __init__(self, cfg, session, agent):
        self.cfg, self.session, self.agent = cfg, session, agent
        self.limit = asyncio.Semaphore(6)

    def backend(self):
        selected = self.cfg.get("MINECRAFT_BACKEND", "auto").lower()
        if selected in {"none", "docker"}:
            return selected
        for name in ("crafty", "pterodactyl", "pelican"):
            if selected not in {"auto", name}:
                continue
            if self.cfg.get(name.upper() + "_BASE_URL") and self.cfg.get(
                name.upper() + "_API_TOKEN"
            ):
                return name
        if selected != "auto":
            raise ValueError(f"Configure {selected.title()}'s base URL and API token")
        return "docker"

    async def request(self, backend, path, *, method="GET", body=None):
        base = self.cfg.get(backend.upper() + "_BASE_URL").rstrip("/")
        parsed = urlsplit(base)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Minecraft panel URL is invalid")
        token = self.cfg.get(backend.upper() + "_API_TOKEN")
        kwargs = {}
        if backend == "crafty" and parsed.scheme == "https":
            kwargs["ssl"] = crafty_tls(self.cfg)
            if self.cfg.get("CRAFTY_CA_CERT_FILE") and self.cfg.get("CRAFTY_TLS_SERVERNAME"):
                kwargs["server_hostname"] = self.cfg.get("CRAFTY_TLS_SERVERNAME")
        try:
            async with (
                self.limit,
                self.session.request(
                    method,
                    base + path,
                    json=body,
                    headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=15),
                    allow_redirects=False,
                    **kwargs,
                ) as response,
            ):
                text = await response.text()
                try:
                    payload = json.loads(text) if text else {}
                except json.JSONDecodeError:
                    raise ValueError("Minecraft panel returned an unexpected response")
                if response.status >= 300:
                    raise ValueError(
                        f"Minecraft panel HTTP {response.status}; check the panel token and permissions"
                    )
                if isinstance(payload, dict) and payload.get("status") in {"error", "failed"}:
                    raise ValueError("Minecraft panel refused the request")
                return payload
        except aiohttp.ClientConnectorCertificateError as exc:
            raise ValueError(
                "Minecraft TLS certificate was rejected. Install Crafty's public certificate and set CRAFTY_CA_CERT_FILE; check its certificate name."
            ) from exc
        except (TimeoutError, aiohttp.ClientError) as exc:
            raise ValueError(
                "Minecraft panel is unreachable or timed out. Check its URL and connection."
            ) from exc

    async def servers(self):
        backend = self.backend()
        if backend == "none":
            return []
        if backend == "docker":
            payload = await self.agent.get("minecraft")
            return [
                {
                    **server,
                    "name": server.get("label") or server.get("name", "Minecraft server"),
                    "backend": "docker",
                    "panel": "Docker",
                    "version": server.get("image"),
                    "resources": server.get("resources") or {},
                    "manageable": False,
                }
                for server in payload.get("servers", [])
            ]
        if backend == "crafty":
            payload = await self.request(backend, "/api/v2/servers")
            rows = payload.get("data", payload) if isinstance(payload, dict) else payload
            if isinstance(rows, dict):
                rows = rows.get("servers", [])
            servers = []
            for item in rows:
                data = item.get("server_data") or item
                identity = str(
                    data.get("server_id") or data.get("id") or item.get("server_id") or ""
                )
                if identity:
                    servers.append(
                        {
                            "id": identity,
                            "name": data.get("server_name")
                            or data.get("name")
                            or "Minecraft server",
                            "running": bool(data.get("running", item.get("running", False))),
                            "version": data.get("minecraft_version") or data.get("version"),
                            "backend": backend,
                            "panel": "Crafty",
                            "manageable": True,
                        }
                    )
        else:
            servers = []
            page = 1
            while page <= 10:
                payload = await self.request(backend, f"/api/client?page={page}")
                for item in payload.get("data", []):
                    data = item.get("attributes", item)
                    identity = str(data.get("identifier") or data.get("uuid") or "")
                    if identity:
                        servers.append(
                            {
                                "id": identity,
                                "name": data.get("name", "Minecraft server"),
                                "backend": backend,
                                "panel": backend.title(),
                                "manageable": True,
                                "running": False,
                            }
                        )
                total = (payload.get("meta") or {}).get("pagination", {}).get("total_pages", 1)
                if page >= total:
                    break
                page += 1
        # Bound concurrency and individual panel timeouts, without blocking Discord heartbeats.
        return list(await asyncio.gather(*(self.with_stats(s) for s in servers[:100])))

    async def with_stats(self, server):
        backend, identity = server["backend"], quote(str(server["id"]), safe="")
        if backend == "docker":
            return server
        try:
            path = (
                f"/api/v2/servers/{identity}/stats"
                if backend == "crafty"
                else f"/api/client/servers/{identity}/resources"
            )
            payload = await self.request(backend, path)
            data = payload.get("data", payload)
            if isinstance(data, list):
                data = data[-1] if data else {}
            data = data.get("attributes", data)
            stats = data.get("stats", data)
            state = data.get("current_state") or stats.get("state")
            running = (
                state == "running" if state else bool(stats.get("running", server.get("running")))
            )
            return {
                **server,
                "resources": resources(stats.get("resources", stats)),
                "running": running,
                "state": state or ("running" if running else "offline"),
            }
        except ValueError as exc:
            return {**server, "state": "unknown", "resource_error": safe_error(exc)}

    async def action(self, identity, action, user):
        if action not in {"start", "stop", "restart", "backup"}:
            raise ValueError("Unsupported Minecraft action")
        backend = self.backend()
        if backend in {"docker", "none"}:
            raise ValueError("Minecraft actions require a configured panel")
        identity = quote(identity, safe="")
        if backend == "crafty":
            return await self.request(
                backend, f"/api/v2/servers/{identity}/action/{action}", method="POST"
            )
        suffix = "backups" if action == "backup" else "power"
        body = {"name": "Homelab Control backup"} if action == "backup" else {"signal": action}
        return await self.request(
            backend, f"/api/client/servers/{identity}/{suffix}", method="POST", body=body
        )

    async def command(self, identity, command):
        backend = self.backend()
        if backend in {"docker", "none"}:
            raise ValueError("Console commands require a configured panel")
        command = command.strip().lstrip("/")
        if not command or "\n" in command or "\r" in command or len(command) > 200:
            raise ValueError("Enter one console command, at most 200 characters")
        if __import__("re").match(
            r"^(stop|restart|reload|op|deop|whitelist\s+off|ban-ip|pardon-ip)\b",
            command,
            __import__("re").I,
        ):
            raise ValueError("Use the dedicated controls or the Minecraft panel for that command")
        path = (
            f"/api/v2/servers/{quote(identity, safe='')}/stdin"
            if backend == "crafty"
            else f"/api/client/servers/{quote(identity, safe='')}/command"
        )
        return await self.request(backend, path, method="POST", body={"command": command})
