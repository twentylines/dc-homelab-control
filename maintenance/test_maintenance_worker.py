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
                    patch.object(self.module, "run_command", return_value=True), \
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


if __name__ == "__main__":
    unittest.main()
