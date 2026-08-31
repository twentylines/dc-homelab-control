import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).with_name("agent.py")


class AgentHelpersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Agent startup reads a secret, so helper-level tests load only after
        # substituting a valid temporary secret through the environment.
        import os
        import tempfile
        cls.tmp = tempfile.NamedTemporaryFile(mode="w", delete=False)
        cls.tmp.write("a" * 64)
        cls.tmp.close()
        os.environ["CONTROL_TOKEN_FILE"] = cls.tmp.name
        spec = importlib.util.spec_from_file_location("homelab_control_agent", MODULE_PATH)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    @classmethod
    def tearDownClass(cls):
        import os
        os.unlink(cls.tmp.name)

    def test_redacts_credentials_and_webhooks(self):
        value = self.module.redact("token=abc https://discord.com/api/webhooks/12/secret")
        self.assertNotIn("abc", value)
        self.assertNotIn("secret", value)

    def test_host_and_container_os_are_reported_as_separate_identities(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            host_file = root / "host-os-release"
            container_file = root / "container-os-release"
            host_file.write_text('ID=ubuntu\nNAME="Ubuntu"\nPRETTY_NAME="Ubuntu Server 24.04.4 LTS"\nVERSION_ID="24.04"\n', encoding="utf-8")
            container_file.write_text('ID=alpine\nNAME="Alpine Linux"\nPRETTY_NAME="Alpine Linux v3.24"\nVERSION_ID="3.24"\n', encoding="utf-8")
            with patch.object(self.module, "HOST_OS_RELEASE_FILE", host_file), \
                    patch.object(self.module, "CONTAINER_OS_RELEASE_FILE", container_file):
                host = self.module.host_os()
                container = self.module.container_os()
        self.assertEqual(host["id"], "ubuntu")
        self.assertEqual(host["pretty_name"], "Ubuntu Server 24.04.4 LTS")
        self.assertEqual(host["source"], "host-os-release")
        self.assertEqual(container["id"], "alpine")
        self.assertEqual(container["pretty_name"], "Alpine Linux v3.24")
        self.assertEqual(container["source"], "container-os-release")

    def test_sanitizes_audit_values(self):
        self.assertEqual(self.module.sanitize_audit_value("Sai\nadmin"), "Sai?admin")

    def test_audit_storage_is_private(self):
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            data_dir = pathlib.Path(directory) / "agent"
            data_dir.mkdir(mode=0o777)
            audit_file = data_dir / "audit.jsonl"
            audit_file.write_text("", encoding="utf-8")
            os.chmod(data_dir, 0o777)
            os.chmod(audit_file, 0o666)
            with patch.object(self.module, "DATA_DIR", data_dir):
                self.module.append_audit({"action": "status", "actor_id": "123"})
            self.assertEqual(data_dir.stat().st_mode & 0o777, 0o700)
            self.assertEqual(audit_file.stat().st_mode & 0o777, 0o600)

    def test_normalises_runtipi_updates_and_protects_control_app(self):
        payload = {
            "installed": [
                {
                    "info": {"urn": "jellyfin", "version": "10.11.8"},
                    "app": {"version": 1},
                    "metadata": {"latestVersion": 2, "latestDockerVersion": "10.11.9"},
                },
                {
                    "info": {"urn": "homelab-control", "version": "0.1.0"},
                    "app": {"version": 1},
                    "metadata": {"latestVersion": 2, "latestDockerVersion": "0.2.0"},
                },
                {
                    "info": {"urn": "sonarr", "version": "4.0.19.2979"},
                    "app": {"version": 3},
                    "metadata": {"latestVersion": 3, "latestDockerVersion": "4.0.19.2979"},
                },
            ]
        }
        updates, protected, total = self.module._installed_app_updates(payload)
        self.assertEqual(total, 3)
        self.assertEqual([row["id"] for row in updates], ["jellyfin"])
        self.assertEqual([row["id"] for row in protected], ["homelab-control"])
        self.assertEqual(updates[0]["tipi_current"], 1)
        self.assertEqual(updates[0]["tipi_latest"], 2)

    def test_app_id_from_runtipi_urn_keeps_app_name_for_scopes(self):
        self.assertEqual(self.module._app_id_from_urn("homelab-control:_user"), "homelab-control")
        self.assertEqual(self.module._app_id_from_urn("jellyfin:migrated"), "jellyfin")
        self.assertEqual(self.module._app_id_from_urn("seerr"), "seerr")

    def test_rejects_malformed_runtipi_catalogue(self):
        with self.assertRaises(RuntimeError):
            self.module._installed_app_updates({"installed": [{"info": {"urn": "jellyfin"}}]})

    def test_docker_resource_math_subtracts_cache_and_keeps_container_limit(self):
        stats = {
            "memory_stats": {
                "usage": 300,
                "limit": 1000,
                "stats": {"inactive_file": 100},
            },
            "cpu_stats": {
                "cpu_usage": {"total_usage": 300},
                "system_cpu_usage": 2_000,
                "online_cpus": 2,
            },
            "precpu_stats": {
                "cpu_usage": {"total_usage": 200},
                "system_cpu_usage": 1_000,
            },
            "pids_stats": {"current": 7},
            "networks": {"eth0": {"rx_bytes": 11, "tx_bytes": 13}},
        }
        entry = {"Id": "abc123", "Names": ["/jellyfin"], "Image": "jellyfin:test", "State": "running"}
        with patch.object(self.module, "docker_json", return_value=stats):
            row, error = self.module._container_resources(entry, 10_000)
        self.assertIsNone(error)
        self.assertEqual(row["memory_used"], 200)
        self.assertEqual(row["memory_limit"], 1000)
        self.assertEqual(row["memory_percent"], 20.0)
        self.assertEqual(row["cpu_percent"], 20.0)
        self.assertEqual(row["pids"], 7)
        self.assertEqual(row["network_rx"], 11)

    def test_minecraft_detection_does_not_misclassify_paperless(self):
        paper = {"Names": ["/paper-survival"], "Image": "itzg/minecraft-server:java21"}
        paperless = {"Names": ["/paperless-ngx"], "Image": "paperlessngx/paperless-ngx:latest"}
        self.assertEqual(self.module._container_category(paper), "minecraft")
        self.assertNotEqual(self.module._container_category(paperless), "minecraft")
        self.assertIn("minecraft", self.module._container_capabilities(paper))

    def test_minecraft_status_discovers_running_servers_with_resources(self):
        entries = [
            {"Id": "paper123", "Names": ["/paper-survival"], "Image": "itzg/minecraft-server:java21", "State": "running", "Status": "Up 2 hours"},
            {"Id": "vanilla123", "Names": ["/vanilla-mc"], "Image": "example/vanilla-minecraft:1.21", "State": "exited", "Status": "Exited (0)"},
            {"Id": "docs123", "Names": ["/paperless-ngx"], "Image": "paperlessngx/paperless-ngx:latest", "State": "running", "Status": "Up 2 hours"},
        ]

        def sample(entry, _host_total):
            return ({"id": entry["Id"], "label": "Paper Survival", "name": entry["Names"][0].lstrip("/"), "memory_used": 512, "cpu_percent": 4.2, "pids": 18}, None)

        with patch.object(self.module, "containers", return_value=entries), \
                patch.object(self.module, "memory_stats", return_value={"total": 10_000}), \
                patch.object(self.module, "_policy_read", return_value={"version": 1, "mode": "opt-in", "overrides": {}}), \
                patch.object(self.module, "_container_resources", side_effect=sample):
            result = self.module.minecraft_status()

        self.assertTrue(result["available"])
        self.assertEqual(result["detected"], 2)
        self.assertEqual([row["name"] for row in result["servers"]], ["paper-survival", "vanilla-mc"])
        self.assertEqual(result["servers"][0]["resources"]["memory_used"], 512)
        self.assertTrue(result["servers"][0]["manageable"] is False)
        self.assertFalse(result["servers"][1]["running"])

    def test_labels_generic_discord_bot_resources(self):
        entry = {
            "Id": "bot123",
            "Names": ["/homelab-control-bot-1"],
            "Image": "ghcr.io/example/homelab-control-bot:0.1.0",
            "State": "running",
            "Labels": {"homelab.control.component": "bot"},
        }
        self.assertEqual(self.module._resource_label(entry), "Homelab Control (Discord bot)")

    def test_labels_control_agent_separately_from_discord_bot(self):
        entry = {
            "Id": "agent123",
            "Names": ["/homelab-control-agent-1"],
            "Image": "ghcr.io/example/homelab-control-agent:0.1.0",
            "State": "running",
            "Labels": {"homelab.control.component": "agent"},
        }
        self.assertEqual(self.module._resource_label(entry), "Control agent")

    def test_service_list_auto_discovers_replacement_and_dependency_containers(self):
        entries = [
            {
                "Id": "known123",
                "Names": ["/jellyfin"],
                "Image": "jellyfin:test",
                "State": "running",
                "Status": "Up 1 hour",
                "Labels": {
                    "com.docker.compose.project": "jellyfin_migrated",
                    "com.docker.compose.service": "jellyfin",
                    "runtipi.appurn": "jellyfin:migrated",
                },
            },
            {
                "Id": "filebrowser1234567890",
                "Names": ["/filebrowser-quantum_migrated-filebrowser-quantum-1"],
                "Image": "gtstef/filebrowser:2-beta",
                "State": "running",
                "Status": "Up 1 hour (healthy)",
                "Labels": {
                    "com.docker.compose.project": "filebrowser-quantum_migrated",
                    "com.docker.compose.service": "filebrowser-quantum",
                    "runtipi.appurn": "filebrowser-quantum:migrated",
                },
            },
            {
                "Id": "paperlessdb123456",
                "Names": ["/paperless-ngx_migrated-db-1"],
                "Image": "postgres:17",
                "State": "running",
                "Status": "Up 1 hour",
                "Labels": {
                    "com.docker.compose.project": "paperless-ngx_migrated",
                    "com.docker.compose.service": "db",
                    "runtipi.appurn": "paperless-ngx:migrated",
                },
            },
        ]
        with patch.object(self.module, "containers", return_value=entries), \
                patch.object(self.module, "apply_service_health", side_effect=lambda rows: rows):
            result = self.module.service_list()
        replacement = next(row for row in result if row["container"] == entries[1]["Names"][0].lstrip("/"))
        dependency = next(row for row in result if row["container"] == entries[2]["Names"][0].lstrip("/"))
        self.assertEqual(replacement["label"], "Filebrowser Quantum")
        self.assertTrue(replacement["discovered"])
        self.assertTrue(replacement["manageable"])
        self.assertEqual(replacement["health"], "healthy")
        self.assertEqual(replacement["health_source"], "docker")
        self.assertEqual(dependency["label"], "Paperless Ngx · DB")
        self.assertTrue(dependency["discovered"])

    def test_dynamic_service_logs_resolve_by_container_identity(self):
        entry = {
            "Id": "filebrowser1234567890",
            "Names": ["/filebrowser-quantum-1"],
            "Image": "gtstef/filebrowser:2-beta",
            "State": "running",
            "Status": "Up 1 hour (healthy)",
            "Labels": {"runtipi.appurn": "filebrowser-quantum:migrated", "com.docker.compose.service": "filebrowser-quantum"},
        }
        key = self.module._dynamic_service_key(entry)
        with patch.object(self.module, "containers", return_value=[entry]), \
                patch.object(self.module, "docker_request", return_value=(200, b"log line\n")):
            self.assertEqual(self.module.service_logs(key, 10), ["log line"])

    def test_known_service_catalogue_accepts_plain_container_names_without_labels(self):
        entry = {
            "Id": "jellyfin-plain",
            "Names": ["/jellyfin-1"],
            "Image": "jellyfin/jellyfin:latest",
            "State": "running",
            "Status": "Up 1 hour",
        }
        definition, container = self.module.resolve_service("jellyfin", [entry])
        self.assertEqual(definition["label"], "Jellyfin")
        self.assertIs(container, entry)

    def test_provider_discovery_prefers_the_app_over_a_same_named_dependency(self):
        entries = [
            {
                "Id": "jellyfin-db",
                "Names": ["/jellyfin_migrated-db-1"],
                "Image": "postgres:17",
                "State": "running",
                "Ports": [],
                "Labels": {
                    "com.docker.compose.project": "jellyfin_migrated",
                    "com.docker.compose.service": "db",
                    "runtipi.appurn": "jellyfin:migrated",
                },
            },
            {
                "Id": "jellyfin-app",
                "Names": ["/jellyfin_migrated-jellyfin-1"],
                "Image": "jellyfin/jellyfin:latest",
                "State": "running",
                "Ports": [{"PublicPort": 18096, "PrivatePort": 8096}],
                "Labels": {
                    "com.docker.compose.project": "jellyfin_migrated",
                    "com.docker.compose.service": "jellyfin",
                    "runtipi.appurn": "jellyfin:migrated",
                },
            },
        ]
        rows = self.module._provider_rows(self.module.MEDIA_PROVIDER_DEFINITIONS, entries)
        self.assertEqual(rows[0]["id"], "jellyfin")
        self.assertEqual(rows[0]["container"], "jellyfin_migrated-jellyfin-1")
        self.assertEqual(rows[0]["port"], 18096)

    def test_media_resources_aggregates_detected_running_media_services(self):
        entries = [
            {"Id": "jellyfin123", "Names": ["/jellyfin"], "Image": "jellyfin:test", "State": "running"},
            {"Id": "seerr123", "Names": ["/seerr_migrated-seerr-1"], "Image": "seerr:test", "State": "running"},
            {"Id": "archive123", "Names": ["/archivebox_migrated-archivebox-1"], "Image": "archivebox:test", "State": "running"},
        ]

        def sample(entry, _host_total):
            amount = 200 if entry["Id"] == "jellyfin123" else 100
            cpu = 2.5 if entry["Id"] == "jellyfin123" else 1.0
            return ({
                "id": entry["Id"],
                "name": entry["Names"][0].lstrip("/"),
                "label": "Jellyfin" if entry["Id"] == "jellyfin123" else "Seerr",
                "memory_used": amount,
                "cpu_percent": cpu,
            }, None)

        with patch.object(self.module, "containers", return_value=entries), \
                patch.object(self.module, "memory_stats", return_value={"total": 10_000}), \
                patch.object(self.module, "_container_resources", side_effect=sample):
            result = self.module.media_resources(force=True)

        self.assertTrue(result["available"])
        self.assertEqual(result["running"], 2)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["sampled"], 2)
        self.assertEqual(result["memory_used"], 300)
        self.assertEqual(result["cpu_percent"], 3.5)
        self.assertEqual(result["failed"], [])
        # Resource totals are based on the services actually detected on this
        # host; absent optional providers are reported by media-summary when
        # they are configured as required, not fabricated into this sample.
        self.assertEqual(result["not_running"], [])
        self.assertNotIn("ArchiveBox", result["not_running"])

    def test_media_resources_reports_reader_failure_without_unbound_error(self):
        with patch.object(self.module, "containers", side_effect=OSError("docker unavailable")):
            result = self.module.media_resources(force=True)
        self.assertFalse(result["available"])
        self.assertEqual(result["total"], 0)
        self.assertIn("Media resource sample unavailable", result["detail"])

    def test_media_summary_names_missing_required_components(self):
        rows = [{"id": "jellyfin", "label": "Jellyfin", "online": True}]
        with patch.object(self.module, "MEDIA_REQUIRED_PROVIDERS", ("jellyfin", "seerr", "radarr")):
            summary = self.module.media_summary(rows)
        self.assertTrue(summary["assessed"])
        self.assertFalse(summary["complete"])
        self.assertEqual(summary["missing"], ["Seerr", "Radarr"])

    def test_provider_discovery_accepts_plex_pihole_and_technitium(self):
        entries = [
            {"Id": "plex1", "Names": ["/plex-server"], "Image": "plexinc/pms-docker", "State": "running", "Ports": [{"PublicPort": 32400, "PrivatePort": 32400}]},
            {"Id": "pihole1", "Names": ["/dns"], "Image": "pihole/pihole", "State": "running", "Ports": [{"PublicPort": 8080, "PrivatePort": 80}]},
            {"Id": "tech1", "Names": ["/technitium"], "Image": "technitium/dns-server", "State": "running", "Ports": [{"PublicPort": 5380, "PrivatePort": 5380}]},
        ]
        media = self.module._provider_rows(self.module.MEDIA_PROVIDER_DEFINITIONS, entries)
        network = self.module._provider_rows(self.module.NETWORK_PROVIDER_DEFINITIONS, entries)
        self.assertEqual([row["id"] for row in media], ["plex"])
        self.assertEqual([row["id"] for row in network], ["pihole", "technitium"])

    def test_provider_discovery_uses_a_single_custom_published_web_port(self):
        entries = [{
            "Id": "plex-custom",
            "Names": ["/plex-custom"],
            "Image": "plexinc/pms-docker",
            "State": "running",
            "Ports": [{"PublicPort": 43210, "PrivatePort": 43210}],
        }]
        rows = self.module._provider_rows(self.module.MEDIA_PROVIDER_DEFINITIONS, entries)
        self.assertEqual(rows[0]["id"], "plex")
        self.assertEqual(rows[0]["port"], 43210)
        self.assertEqual(rows[0]["port_source"], "published")

    def test_provider_discovery_does_not_guess_between_multiple_custom_ports(self):
        entries = [{
            "Id": "plex-multi-port",
            "Names": ["/plex-multi-port"],
            "Image": "plexinc/pms-docker",
            "State": "running",
            "Ports": [
                {"PublicPort": 43210, "PrivatePort": 43210},
                {"PublicPort": 43211, "PrivatePort": 43211},
            ],
        }]
        rows = self.module._provider_rows(self.module.MEDIA_PROVIDER_DEFINITIONS, entries)
        self.assertEqual(rows[0]["id"], "plex")
        self.assertIsNone(rows[0]["port"])
        self.assertEqual(rows[0]["port_source"], "ambiguous")
        self.assertIsNone(rows[0]["url"])

    def test_service_health_does_not_red_bridge_only_or_guess_multiple_ports(self):
        bridge_only = {
            "key": "jellyfin", "container": "jellyfin", "state": "running", "health": "process",
            "health_source": "process", "_container": {"Names": ["/jellyfin"], "Ports": []},
        }
        with patch.object(self.module, "http_probe", side_effect=AssertionError("unpublished service must not be probed")):
            result = self.module.apply_service_health([bridge_only])[0]
        self.assertEqual(result["health"], "process")

        multi_port = {
            "key": "jellyfin", "container": "jellyfin", "state": "running", "health": "process",
            "health_source": "process", "_container": {
                "Names": ["/jellyfin"],
                "Ports": [{"PublicPort": 9000, "PrivatePort": 9000}, {"PublicPort": 9001, "PrivatePort": 9001}],
            },
        }
        with patch.object(self.module, "http_probe", side_effect=AssertionError("ambiguous ports must not be guessed")):
            result = self.module.apply_service_health([multi_port])[0]
        self.assertEqual(result["health"], "process")

    def test_update_verification_uses_one_custom_port_and_rejects_ambiguous_ports(self):
        candidate = {"Id": "sonarr123", "Names": ["/sonarr"], "State": "running"}
        inspected = {
            "State": {"Running": True, "Status": "running"},
            "NetworkSettings": {"Ports": {"8989/tcp": [{"HostPort": "18989"}]}},
        }
        with patch.object(self.module, "resolve_app_container", return_value=candidate), \
                patch.object(self.module, "_container_inspect", return_value=inspected), \
                patch.object(self.module, "http_probe", return_value={"health": "healthy", "health_detail": "HTTP 200 • 7 ms"}) as probe:
            result = self.module.verify_app_container("sonarr")
        self.assertTrue(result["ok"])
        self.assertEqual(result["port"], 18989)
        self.assertIn("7 ms", result["detail"])
        self.assertEqual(probe.call_args.args[0]["port"], 18989)

        ambiguous = {
            "State": {"Running": True, "Status": "running"},
            "NetworkSettings": {"Ports": {
                "8989/tcp": [{"HostPort": "18989"}],
                "9989/tcp": [{"HostPort": "19989"}],
            }},
        }
        with patch.object(self.module, "resolve_app_container", return_value={"Id": "custom123", "Names": ["/custom"], "State": "running"}), \
                patch.object(self.module, "_container_inspect", return_value=ambiguous), \
                patch.object(self.module, "http_probe", side_effect=AssertionError("ambiguous ports must not be guessed")), \
                patch.object(self.module, "_tcp_probe", side_effect=AssertionError("ambiguous ports must not be probed")):
            result = self.module.verify_app_container("custom-app")
        self.assertFalse(result["ok"])
        self.assertIn("Published ports are ambiguous", result["detail"])
        self.assertIsNone(result["port"])

    def test_network_summary_names_only_configured_missing_providers(self):
        rows = [{"id": "pihole", "label": "Pi-hole", "online": True}]
        with patch.object(self.module, "NETWORK_REQUIRED_PROVIDERS", ("pihole", "technitium")):
            summary = self.module.network_summary(rows)
        self.assertTrue(summary["assessed"])
        self.assertFalse(summary["complete"])
        self.assertEqual(summary["missing"], ["Technitium DNS"])

    def test_network_summary_stays_quiet_when_unconfigured(self):
        with patch.object(self.module, "NETWORK_REQUIRED_PROVIDERS", ()):
            summary = self.module.network_summary([])
        self.assertFalse(summary["assessed"])
        self.assertIsNone(summary["complete"])

    def test_runtipi_update_preserves_namespaced_lifecycle_urn(self):
        row = {
            "id": "filebrowser",
            "urn": "filebrowser:migrated",
            "label": "Filebrowser",
            "current": "s6",
            "latest": "v2.63.23",
            "tipi_current": 9,
            "tipi_latest": 10,
        }
        calls = []

        def request(path, method="GET", body=None, timeout=20):
            calls.append((path, method, body, timeout))
            return {"requestId": "request-123"}

        with patch.object(self.module, "resolve_app_container", return_value={"Id": "file123", "Names": ["/filebrowser"], "State": "running"}), \
                patch.object(self.module, "_runtipi_request", side_effect=request), \
                patch.object(self.module, "_wait_for_updated_app", return_value={"ok": True, "version": 10, "verification": {"container": "filebrowser", "detail": "Docker running"}}):
            result = self.module._update_one_locked(row, "123", "Sai")

        self.assertEqual(result["status"], "updated")
        self.assertEqual(calls[0], ("app-lifecycle/filebrowser%3Amigrated/update", "PATCH", {"performBackup": True}, 30))

    def test_bot_release_asset_requires_github_sha256_digest(self):
        payload = {
            "tag_name": "v0.3.18",
            "assets": [{
                "name": "homelab-control-0.3.18.tar.gz",
                "browser_download_url": "https://github.com/example/homelab-control/releases/download/v0.3.18/homelab-control-0.3.18.tar.gz",
                "digest": "sha256:" + "a" * 64,
            }],
        }
        asset, detail = self.module._release_archive_asset(payload)
        self.assertIsNone(detail)
        self.assertTrue(asset["digest"].startswith("sha256:"))
        payload["assets"][0].pop("digest")
        asset, detail = self.module._release_archive_asset(payload)
        self.assertIsNone(asset["digest"])
        self.assertIn("SHA-256", detail)

    def test_bot_release_status_reports_verified_new_release(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "HOMELAB_CONTROL_REPOSITORY", "example/homelab-control"), \
                patch.object(self.module, "HOMELAB_CONTROL_VERSION", "0.3.17"), \
                patch.object(self.module, "BOT_RELEASE_STATUS_FILE", pathlib.Path(directory) / "bot-release.json"), \
                patch.object(self.module, "_github_releases_payload", return_value=[]), \
                patch.object(self.module, "_github_release_payload", return_value={
                    "tag_name": "v0.3.18",
                    "prerelease": False,
                    "body": "## Changes\n- Safer restart hand-off\n- token=do-not-forward",
                    "html_url": "https://github.com/example/homelab-control/releases/tag/v0.3.18",
                    "assets": [{
                        "name": "homelab-control-0.3.18.tar.gz",
                        "browser_download_url": "https://github.com/example/homelab-control/releases/download/v0.3.18/homelab-control-0.3.18.tar.gz",
                        "digest": "sha256:" + "b" * 64,
                        "size": 987654,
                    }],
                }):
            self.module._bot_release_cache_value = None
            self.module._bot_release_cache_timestamp = 0.0
            status = self.module.bot_release_status(force=True)
        self.assertTrue(status["available"])
        self.assertTrue(status["configured"])
        self.assertEqual(status["current"], "0.3.17")
        self.assertEqual(status["latest"], "0.3.18")
        self.assertTrue(status["update_available"])
        self.assertTrue(status["asset_verified"])
        self.assertEqual(status["asset_size"], 987654)
        self.assertIn("Safer restart hand-off", status["release_notes"])
        self.assertNotIn("do-not-forward", status["release_notes"])

    def test_bot_release_status_detects_compact_b_hotfix(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "HOMELAB_CONTROL_REPOSITORY", "example/homelab-control"), \
                patch.object(self.module, "HOMELAB_CONTROL_VERSION", "0.3.22"), \
                patch.object(self.module, "BOT_RELEASE_STATUS_FILE", pathlib.Path(directory) / "bot-release.json"), \
                patch.object(self.module, "_github_releases_payload", return_value=[]), \
                patch.object(self.module, "_github_release_payload", return_value={
                    "tag_name": "v0.3.22b",
                    "prerelease": False,
                    "body": "## 0.3.22b\n\n1. Changelog is visible in the confirmation panel.",
                    "html_url": "https://github.com/example/homelab-control/releases/tag/v0.3.22b",
                    "assets": [{
                        "name": "homelab-control-0.3.22b.tar.gz",
                        "browser_download_url": "https://github.com/example/homelab-control/releases/download/v0.3.22b/homelab-control-0.3.22b.tar.gz",
                        "digest": "sha256:" + "c" * 64,
                    }],
                }):
            self.module._bot_release_cache_value = None
            self.module._bot_release_cache_timestamp = 0.0
            status = self.module.bot_release_status(force=True)
        self.assertEqual(status["latest"], "0.3.22b")
        self.assertTrue(status["update_available"])
        self.assertIn("Changelog is visible", status["release_notes"])
        self.assertIsNone(status["asset_size"])

    def test_compact_letter_hotfixes_are_ordered(self):
        self.assertEqual(self.module._release_version("v0.3.22D"), "0.3.22d")
        self.assertGreater(self.module._release_version_key("0.3.22c"), self.module._release_version_key("0.3.22b"))
        self.assertGreater(self.module._release_version_key("0.3.22b"), self.module._release_version_key("0.3.22"))

    def test_bot_release_status_discovers_verified_previous_github_release(self):
        import tempfile

        def archive(version):
            return {
                "name": f"homelab-control-{version}.tar.gz",
                "browser_download_url": f"https://github.com/example/homelab-control/releases/download/v{version}/homelab-control-{version}.tar.gz",
                "digest": "sha256:" + ("c" if version == "0.3.18" else "d") * 64,
                "size": 1234567 if version == "0.3.18" else 2345678,
            }

        releases = [
            {"tag_name": "v0.3.19", "prerelease": False, "assets": [archive("0.3.19")]},
            {"tag_name": "v0.3.18", "prerelease": False, "html_url": "https://github.com/example/homelab-control/releases/tag/v0.3.18", "assets": [archive("0.3.18")]},
            {"tag_name": "v0.3.17", "prerelease": False, "assets": [archive("0.3.17")]},
            {"tag_name": "v0.3.20-rc.1", "prerelease": True, "assets": [archive("0.3.20-rc.1")]},
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "HOMELAB_CONTROL_REPOSITORY", "example/homelab-control"), \
                patch.object(self.module, "HOMELAB_CONTROL_VERSION", "0.3.19"), \
                patch.object(self.module, "BOT_RELEASE_STATUS_FILE", pathlib.Path(directory) / "bot-release.json"), \
                patch.object(self.module, "_github_release_payload", return_value=releases[0]), \
                patch.object(self.module, "_github_releases_payload", return_value=releases):
            self.module._bot_release_cache_value = None
            self.module._bot_release_cache_timestamp = 0.0
            status = self.module.bot_release_status(force=True)
        self.assertTrue(status["rollback_available"])
        self.assertEqual(status["rollback_source"], "github")
        self.assertEqual(status["rollback_version"], "0.3.18")
        self.assertTrue(status["github_rollback_available"])
        self.assertEqual(status["github_rollback"]["asset_digest"], "sha256:" + "c" * 64)
        self.assertEqual([item["version"] for item in status["rollback_options"]], ["0.3.18", "0.3.17"])
        self.assertEqual(status["rollback_options"][0]["asset_size"], 1234567)

    def test_bot_release_status_limits_rollback_history_to_verified_archives(self):
        import tempfile

        def release(version, digest=None):
            asset = {
                "name": f"homelab-control-{version}.tar.gz",
                "browser_download_url": f"https://github.com/example/homelab-control/releases/download/v{version}/homelab-control-{version}.tar.gz",
                "digest": digest or "sha256:" + "a" * 64,
                "size": 4567890,
            }
            return {"tag_name": f"v{version}", "prerelease": False, "assets": [asset]}

        releases = [release("0.3.22c"), release("0.3.22b"), release("0.3.22"), release("0.3.21"), release("0.3.20", "sha256:not-a-digest")]
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "HOMELAB_CONTROL_REPOSITORY", "example/homelab-control"), \
                patch.object(self.module, "HOMELAB_CONTROL_VERSION", "0.3.22c"), \
                patch.object(self.module, "BOT_RELEASE_STATUS_FILE", pathlib.Path(directory) / "bot-release.json"), \
                patch.object(self.module, "_github_release_payload", return_value=releases[0]), \
                patch.object(self.module, "_github_releases_payload", return_value=releases):
            self.module._bot_release_cache_value = None
            self.module._bot_release_cache_timestamp = 0.0
            status = self.module.bot_release_status(force=True)
        self.assertEqual([item["version"] for item in status["rollback_options"]], ["0.3.22b", "0.3.22", "0.3.21"])
        self.assertNotIn("0.3.20", [item["version"] for item in status["rollback_options"]])

    def test_bot_release_status_keeps_github_rollback_when_latest_check_is_unavailable(self):
        import tempfile

        previous = {
            "tag_name": "v0.3.18",
            "prerelease": False,
            "assets": [{
                "name": "homelab-control-0.3.18.tar.gz",
                "browser_download_url": "https://github.com/example/homelab-control/releases/download/v0.3.18/homelab-control-0.3.18.tar.gz",
                "digest": "sha256:" + "e" * 64,
            }],
        }
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "HOMELAB_CONTROL_REPOSITORY", "example/homelab-control"), \
                patch.object(self.module, "HOMELAB_CONTROL_VERSION", "0.3.19"), \
                patch.object(self.module, "BOT_RELEASE_STATUS_FILE", pathlib.Path(directory) / "bot-release.json"), \
                patch.object(self.module, "_github_release_payload", side_effect=RuntimeError("GitHub latest unavailable")), \
                patch.object(self.module, "_github_releases_payload", return_value=[previous]):
            self.module._bot_release_cache_value = None
            self.module._bot_release_cache_timestamp = 0.0
            status = self.module.bot_release_status(force=True)
        self.assertFalse(status["available"])
        self.assertTrue(status["rollback_available"])
        self.assertEqual(status["rollback_source"], "github")
        self.assertEqual(status["rollback_version"], "0.3.18")

    def test_selected_rollback_queues_the_exact_github_option(self):
        import tempfile

        selected = {
            "version": "0.3.17",
            "tag": "v0.3.17",
            "asset_name": "homelab-control-0.3.17.tar.gz",
            "asset_url": "https://github.com/example/homelab-control/releases/download/v0.3.17/homelab-control-0.3.17.tar.gz",
            "asset_digest": "sha256:" + "f" * 64,
        }
        snapshot = {
            "phase": "idle",
            "configured": True,
            "update_supported": True,
            "rollback_available": True,
            "rollback_source": "github",
            "rollback_options": [selected, {**selected, "version": "0.3.16", "tag": "v0.3.16"}],
            "github_rollback_available": True,
            "github_rollback": selected,
            "repository": "example/homelab-control",
        }
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            writes = []
            with patch.object(self.module, "MAINTENANCE_DIR", root), \
                    patch.object(self.module, "SYSTEM_REQUEST_FILE", root / "request.json"), \
                    patch.object(self.module, "bot_release_status", return_value=snapshot), \
                    patch.object(self.module, "_write_maintenance_request", side_effect=lambda request: writes.append(dict(request))), \
                    patch.object(self.module, "append_audit"):
                result = self.module._queue_bot_release_request("bot_rollback", "123", "Sai", "0.3.17")
        self.assertEqual(result["version"], "0.3.17")
        self.assertEqual(writes[0]["selected_version"], "0.3.17")
        self.assertEqual(writes[0]["asset_url"], selected["asset_url"])
        self.assertEqual(writes[0]["asset_digest"], selected["asset_digest"])

    def test_jellyfin_preferred_user_scope_uses_administrator_without_exposing_it(self):
        users = [
            {"Id": "tv-id", "Name": "TV", "Policy": {"IsDisabled": False, "IsAdministrator": False}},
            {"Id": "sai-id", "Name": "Sai", "Policy": {"IsDisabled": False, "IsAdministrator": True}},
        ]
        with patch.object(self.module, "JELLYFIN_USER_ID", ""), patch.object(self.module, "_jellyfin_request", return_value=(users, None)):
            user_id, error = self.module._jellyfin_preferred_user_id()
        self.assertEqual(user_id, "sai-id")
        self.assertIsNone(error)

    def test_jellyfin_preferred_user_scope_skips_disabled_profiles(self):
        users = [
            {"Id": "disabled-id", "Name": "Disabled", "Policy": {"IsDisabled": True}},
            {"Id": "tv-id", "Name": "TV", "Policy": {"IsDisabled": False}},
        ]
        with patch.object(self.module, "JELLYFIN_USER_ID", ""), patch.object(self.module, "_jellyfin_request", return_value=(users, None)):
            user_id, error = self.module._jellyfin_preferred_user_id()
        self.assertEqual(user_id, "tv-id")
        self.assertIsNone(error)

    def test_jellyfin_recent_items_preserve_season_for_compact_show_rows(self):
        items = [{
            "Name": "Season 1",
            "SeriesName": "Marvel's The Defenders",
            "Type": "Season",
            "ProductionYear": 2017,
            "IndexNumber": 1,
        }]
        self.assertEqual(self.module._jellyfin_recent_items(items), [{
            "title": "Marvel's The Defenders",
            "type": "Season",
            "year": 2017,
            "season": 1,
        }])

    def test_system_updates_merges_read_only_notifier_and_bridge_status(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            notifier_dir = root / "update-notifier"
            maintenance_dir = root / "maintenance"
            notifier_dir.mkdir()
            maintenance_dir.mkdir()
            (notifier_dir / "updates-available").write_text(
                "Expanded Security Maintenance for Applications is not enabled.\n"
                "10 updates can be applied immediately.\n"
                "3 of these updates are standard security updates.\n",
                encoding="utf-8",
            )
            status = {
                "available": True,
                "checked_at": "2026-08-27T10:00:00+00:00",
                "phase": "idle",
                "packages": [{"name": "openssl", "latest": "3.0.0"}],
                "events": [{"at": "now", "message": "Catalogue refreshed"}],
            }
            (maintenance_dir / "status.json").write_text(json.dumps(status), encoding="utf-8")
            with patch.object(self.module, "HOST_UPDATE_NOTIFIER_DIR", notifier_dir), \
                    patch.object(self.module, "MAINTENANCE_DIR", maintenance_dir), \
                    patch.object(self.module, "SYSTEM_STATUS_FILE", maintenance_dir / "status.json"), \
                    patch.object(self.module, "SYSTEM_REQUEST_FILE", maintenance_dir / "request.json"):
                snapshot = self.module.system_updates()
                self.assertTrue(snapshot["available"])
                self.assertEqual(snapshot["pending_count"], 1)
                self.assertEqual(snapshot["security_count"], 3)
                self.assertFalse(snapshot["esm_enabled"])
                self.assertEqual(snapshot["phase"], "idle")
                self.assertEqual(snapshot["packages"][0]["name"], "openssl")
                self.assertTrue(snapshot["maintenance_available"])

    def test_system_updates_uses_live_host_os_and_exposes_container_os(self):
        import tempfile

        host = {"id": "ubuntu", "name": "Ubuntu", "pretty_name": "Ubuntu Server 24.04.4 LTS", "version_id": "24.04", "source": "test"}
        container = {"id": "alpine", "name": "Alpine Linux", "pretty_name": "Alpine Linux v3.24", "version_id": "3.24", "source": "test"}
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            maintenance_dir = root / "maintenance"
            maintenance_dir.mkdir()
            (maintenance_dir / "status.json").write_text(json.dumps({
                "kind": "bot",
                "phase": "restarting",
                "os": {"id": "alpine", "name": "Alpine Linux", "pretty_name": "Alpine Linux v3.24"},
                "current_version": "0.3.21",
            }), encoding="utf-8")
            with patch.object(self.module, "HOST_UPDATE_NOTIFIER_DIR", root / "missing"), \
                    patch.object(self.module, "MAINTENANCE_DIR", maintenance_dir), \
                    patch.object(self.module, "SYSTEM_STATUS_FILE", maintenance_dir / "status.json"), \
                    patch.object(self.module, "host_os", return_value=host), \
                    patch.object(self.module, "container_os", return_value=container):
                snapshot = self.module.system_updates()
        self.assertEqual(snapshot["os"]["id"], "ubuntu")
        self.assertEqual(snapshot["os"]["pretty_name"], "Ubuntu Server 24.04.4 LTS")
        self.assertEqual(snapshot["container_os"]["id"], "alpine")
        self.assertEqual(snapshot["phase"], "idle")

    def test_system_update_request_is_allowlisted_and_atomic(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            maintenance_dir = root / "maintenance"
            maintenance_dir.mkdir()
            (maintenance_dir / "status.json").write_text(json.dumps({
                "available": True,
                "phase": "idle",
                "pending_count": 2,
                "reboot_required": False,
            }), encoding="utf-8")
            with patch.object(self.module, "HOST_UPDATE_NOTIFIER_DIR", root / "missing"), \
                    patch.object(self.module, "MAINTENANCE_DIR", maintenance_dir), \
                    patch.object(self.module, "SYSTEM_STATUS_FILE", maintenance_dir / "status.json"), \
                    patch.object(self.module, "SYSTEM_REQUEST_FILE", maintenance_dir / "request.json"), \
                    patch.object(self.module, "host_os", return_value={"id": "ubuntu", "name": "Ubuntu", "pretty_name": "Ubuntu 24.04", "version_id": "24.04", "source": "test"}):
                result = self.module._queue_system_request("apply_updates", "123", "Sai")
                self.assertTrue(result["accepted"])
                request = json.loads((maintenance_dir / "request.json").read_text(encoding="utf-8"))
                self.assertEqual(request["action"], "apply_updates")
                self.assertEqual(len(request["job_id"]), 24)
                with self.assertRaises(RuntimeError):
                    self.module._queue_system_request("apply_updates", "123", "Sai")


if __name__ == "__main__":
    unittest.main()
