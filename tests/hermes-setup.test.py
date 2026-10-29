import contextlib
import io
import json
import pathlib
import runpy
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/hermes-instance-setup.py"


class HermesSetupTest(unittest.TestCase):
    def test_setup_writes_per_instance_credentials_and_private_worker_stream(self):
        real_path = pathlib.Path
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            root = real_path(directory)
            (root / "etc").mkdir()
            home = root / "home/ubuntu"
            (home / ".local/bin").mkdir(parents=True)
            (home / ".local/bin/hermes").touch()
            (home / ".hermes").mkdir()
            (home / ".hermes/.env").write_text("TELEGRAM_ALLOWED_USERS=123\nTELEGRAM_BOT_TOKEN=old\nOPENROUTER_API_KEY=shared-provider-key\nOTHER=preserved\n")

            def fake_path(value):
                value = str(value)
                return root / value.lstrip("/") if value.startswith(("/home/", "/etc/")) else real_path(value)

            def fake_run(args, **kwargs):
                calls.append(args)
                if args[:2] == ("git", "clone"):
                    real_path(args[-1]).mkdir(parents=True)
                return type("Result", (), {"stdout": "consumer listening for tasks", "stderr": "", "returncode": 0})()

            class Response:
                status = 200
                def __enter__(self): return self
                def __exit__(self, *args): return False

            payload = {"telegramBotToken": "123456:secret", "apiKey": "a" * 64,
                       "consumerName": "oc-owner-123", "redisUrl": "rediss://redis.example:6380"}
            with patch("pathlib.Path", side_effect=fake_path), patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                    patch("subprocess.run", side_effect=fake_run), patch("subprocess.check_output", return_value="true\n"), \
                    patch("tempfile.mkdtemp", return_value=str(root / "build")), \
                    patch("urllib.request.urlopen", return_value=Response()), patch("time.sleep"), \
                    contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(SCRIPT), run_name="__main__")

            env = (home / ".hermes/.env").read_text()
            self.assertNotIn("TELEGRAM_ALLOWED_USERS", env)
            self.assertNotIn("TELEGRAM_BOT_TOKEN=old", env)
            self.assertIn('TELEGRAM_BOT_TOKEN="123456:secret"', env)
            self.assertIn("OTHER=preserved", env)
            self.assertIn("OPENROUTER_API_KEY=shared-provider-key", env)
            worker = (root / "etc/2ndbrain/gyne-hermes.env").read_text()
            self.assertIn("TASK_STREAM=openclaw:private:oc-owner-123", worker)
            self.assertIn("CONSUMER_TASK_STREAM=openclaw:tasks:oc-owner-123", worker)
            self.assertIn("REDIS_URL=rediss://redis.example:6380", worker)
            self.assertEqual((root / "etc/2ndbrain/gyne-hermes.env").stat().st_mode & 0o777, 0o600)
            self.assertFalse(any(payload["telegramBotToken"] in str(call) or payload["apiKey"] in str(call) for call in calls))


if __name__ == "__main__":
    unittest.main()
