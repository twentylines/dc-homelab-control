import importlib.util
import pathlib
import unittest
from unittest.mock import patch


MODULE_PATH = pathlib.Path(__file__).with_name("homelab-control-maintenance-worker.py")


class MaintenanceWorkerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("homelab_control_maintenance_worker", MODULE_PATH)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_release_version_comparison_orders_stable_versions(self):
        self.assertLess(self.module._release_version_key("v0.3.18"), self.module._release_version_key("0.3.19"))
        self.assertLess(self.module._release_version_key("0.3.19-rc.1"), self.module._release_version_key("0.3.19"))
        self.assertGreater(self.module._release_version_key("0.3.22b"), self.module._release_version_key("0.3.22"))
        self.assertGreater(self.module._release_version_key("0.3.22c"), self.module._release_version_key("0.3.22b"))
        self.assertGreater(self.module._release_version_key("0.4.0-beta.10"), self.module._release_version_key("0.4.0-beta.2"))
        self.assertGreater(self.module._release_version_key("0.4.0"), self.module._release_version_key("0.4.0-rc.1"))
        self.assertEqual(self.module.bot_version("v0.3.22B"), "0.3.22b")
        self.assertEqual(self.module.bot_version("v0.3.22D"), "0.3.22d")
        self.assertIsNone(self.module._release_version_key("latest"))

    def test_release_request_requires_exact_configured_github_asset(self):
        request = {
            "repository": "example/homelab-control",
            "tag": "v0.3.18",
            "version": "0.3.18",
            "asset_name": "homelab-control-0.3.18.tar.gz",
            "asset_url": "https://github.com/example/homelab-control/releases/download/v0.3.18/homelab-control-0.3.18.tar.gz",
            "asset_digest": "sha256:" + "a" * 64,
        }
        with patch.object(self.module, "BOT_RELEASE_REPOSITORY", "example/homelab-control"):
            validated = self.module.validated_release_request(request)
            self.assertEqual(validated[1:4], ("v0.3.18", "0.3.18", "homelab-control-0.3.18.tar.gz"))
            request["asset_url"] += "?download=1"
            with self.assertRaises(RuntimeError):
                self.module.validated_release_request(request)

    def test_rollback_builds_the_verified_github_release_when_local_images_are_missing(self):
        import tempfile

        request = {
            "repository": "example/homelab-control",
            "tag": "v0.3.18",
            "version": "0.3.18",
            "asset_name": "homelab-control-0.3.18.tar.gz",
            "asset_url": "https://github.com/example/homelab-control/releases/download/v0.3.18/homelab-control-0.3.18.tar.gz",
            "asset_digest": "sha256:" + "b" * 64,
            "job_id": "rollback-job",
        }
        current = {"agent_image": "local/homelab-control-agent:0.3.19", "bot_image": "local/homelab-control-bot:0.3.19"}
        writes = []
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            compose_file = root / "compose.yml"
            compose_file.write_text("services: {}\n", encoding="utf-8")
            with patch.object(self.module, "BOT_RELEASE_REPOSITORY", "example/homelab-control"), \
                    patch.object(self.module, "BOT_RELEASE_COMPOSE_FILE", compose_file), \
                    patch.object(self.module, "BOT_RELEASE_ROOT", root / "releases"), \
                    patch.object(self.module, "read_bot_status", return_value={"phase": "idle", "rollback_available": False}), \
                    patch.object(self.module, "release_snapshot", return_value=current), \
                    patch.object(self.module, "bot_update_supported", return_value=True), \
                    patch.object(self.module, "stage_verified_release", return_value=(root / "releases" / "0.3.18", "0.3.18")) as stage, \
                    patch.object(self.module, "compose_override"), \
                    patch.object(self.module, "run_bot_command", return_value=True), \
                    patch.object(self.module, "wait_control_health", return_value=True), \
                    patch.object(self.module, "append_bot_event"), \
                    patch.object(self.module, "write_bot_status", side_effect=lambda status: writes.append(dict(status))):
                self.module.run_bot_rollback(request)
        self.assertTrue(writes)
        final = writes[-1]
        self.assertEqual(final["phase"], "rolled_back")
        self.assertEqual(final["current_version"], "0.3.18")
        self.assertEqual(final["rollback_source"], "github")
        self.assertTrue(final["rollback_available"])
        self.assertEqual(stage.call_args.args[1], request)

    def test_bot_release_commands_keep_progress_out_of_host_status(self):
        class Process:
            stdout = []

            def wait(self, timeout=None):
                return 0

        status = {"kind": "bot", "phase": "building", "events": []}
        host_events = []
        host_writes = []
        bot_events = []
        bot_writes = []
        with patch.object(self.module.subprocess, "Popen", return_value=Process()), \
                patch.object(self.module, "append_event", side_effect=lambda value, message: host_events.append(message)), \
                patch.object(self.module, "save_status", side_effect=lambda value: host_writes.append(dict(value))), \
                patch.object(self.module, "append_bot_event", side_effect=lambda value, message: bot_events.append(message)), \
                patch.object(self.module, "write_bot_status", side_effect=lambda value: bot_writes.append(dict(value))):
            self.assertTrue(self.module.run_bot_command(status, ["docker", "compose", "build"], "Building control images"))
        self.assertEqual(host_events, [])
        self.assertEqual(host_writes, [])
        self.assertEqual(bot_events, ["Building control images"])
        self.assertEqual(len(bot_writes), 1)

    def test_legacy_bot_snapshot_is_not_treated_as_host_status(self):
        self.assertTrue(self.module.looks_like_bot_status({"current_version": "0.3.21"}))
        self.assertTrue(self.module.looks_like_bot_status({"kind": "bot", "phase": "restarting"}))
        self.assertFalse(self.module.looks_like_bot_status({"kind": "host", "phase": "restarting"}))

    def test_settings_reset_clears_config_and_runtime_files_after_backup(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config = root / "config.env"
            runtime = root / "settings.json"
            config.write_text("BOT_NAME=Private\n", encoding="utf-8")
            runtime.write_text('{"autoUpdateMode":"daily"}\n', encoding="utf-8")
            with patch.object(self.module, "CONTROL_CONFIG_FILE", config), \
                    patch.object(self.module, "BOT_SETTINGS_FILE", runtime), \
                    patch.object(self.module, "SETTINGS_BACKUP_ROOT", root / "backups"):
                config_backup = self.module._backup_control_config()
                runtime_backup = self.module._backup_runtime_settings()
                self.assertTrue(self.module._reset_control_config())
                self.assertTrue(self.module._reset_runtime_settings())
            self.assertEqual(config.read_text(encoding="utf-8"), "")
            self.assertEqual(runtime.read_text(encoding="utf-8"), "{}\n")
            self.assertIsNotNone(config_backup)
            self.assertIsNotNone(runtime_backup)
            self.assertEqual(pathlib.Path(config_backup).read_text(encoding="utf-8"), "BOT_NAME=Private\n")
            self.assertEqual(pathlib.Path(runtime_backup).read_text(encoding="utf-8"), '{"autoUpdateMode":"daily"}\n')


if __name__ == "__main__":
    unittest.main()
