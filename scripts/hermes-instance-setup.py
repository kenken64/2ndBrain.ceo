#!/usr/bin/env python3
"""Configure one native Hermes snapshot. Configuration arrives on stdin."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

settings = json.load(__import__("sys").stdin)
home = Path("/home/ubuntu")
hermes_home = home / ".hermes"
env_path = hermes_home / ".env"
if not (home / ".local/bin/hermes").is_file() or not env_path.is_file():
    raise RuntimeError("Expected a native clawmacdo Hermes snapshot")
original_env = env_path.read_text()
if not any(
    line.strip().removeprefix("export ").startswith("OPENROUTER_API_KEY=")
    and line.split("=", 1)[1].strip().strip("\"'")
    for line in original_env.splitlines() if "=" in line and not line.lstrip().startswith("#")
):
    raise RuntimeError("Snapshot is missing its shared OpenRouter key")

def run(*args, timeout=900):
    subprocess.run(args, check=True, timeout=timeout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def env_file(path, values, remove=(), quote=True):
    old = path.read_text() if path.exists() else ""
    names = set(values) | set(remove)
    lines = [line for line in old.splitlines() if line.split("=", 1)[0].strip().removeprefix("export ").strip() not in names]
    for key, value in values.items():
        if "\n" in value or "\r" in value:
            raise ValueError("Environment values must be single-line")
        lines.append(key + "=" + (json.dumps(value) if quote else value))
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o600)

run("systemctl", "stop", "hermes-gateway.service")
env_file(env_path, {
    "TELEGRAM_BOT_TOKEN": settings["telegramBotToken"],
    "API_SERVER_ENABLED": "true",
    "API_SERVER_HOST": "127.0.0.1",
    "API_SERVER_KEY": settings["apiKey"],
}, ("TELEGRAM_ALLOWED_USERS", "TELEGRAM_HOME_CHANNEL", "GATEWAY_ALLOW_ALL_USERS"))
run("chown", "ubuntu:ubuntu", str(env_path))
run("systemctl", "enable", "hermes-gateway.service")
run("systemctl", "restart", "hermes-gateway.service")
for attempt in range(60):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8642/health", timeout=2) as response:
            if response.status == 200:
                break
    except Exception:
        time.sleep(2)
else:
    raise RuntimeError("Hermes API did not become ready")

run("apt-get", "update", "-qq")
run("apt-get", "install", "-y", "-qq", "docker.io", "git", timeout=900)
run("systemctl", "enable", "--now", "docker")
work = Path(tempfile.mkdtemp(prefix="gyne-build-"))
try:
    run("git", "clone", "--quiet", "https://github.com/kenken64/gyne-agent.git", str(work / "repo"))
    repo = work / "repo"
    run("git", "-C", str(repo), "checkout", "--quiet", "cb59574ea2b87b62b2be372f42d209f89bc35caf")
    (repo / "Dockerfile.hermes-consumer").write_text('''FROM rust:1.86-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY task-core ./task-core
COPY publisher ./publisher
COPY consumer ./consumer
RUN cargo build --locked --release -p consumer
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/consumer /usr/local/bin/gyne-consumer
CMD ["/usr/local/bin/gyne-consumer"]
''')
    run("docker", "build", "-q", "-f", str(repo / "Dockerfile.hermes-consumer"), "-t", "2ndbrain-gyne-consumer:hermes", str(repo), timeout=1800)
finally:
    __import__("shutil").rmtree(work, ignore_errors=True)

worker_dir = Path("/etc/2ndbrain")
worker_dir.mkdir(mode=0o700, exist_ok=True)
worker_env = worker_dir / "gyne-hermes.env"
env_file(worker_env, {
    "REDIS_URL": settings["redisUrl"],
    "CONSUMER_NAME": settings["consumerName"],
    "TASK_STREAM": "openclaw:private:" + settings["consumerName"],
    "CONSUMER_TASK_STREAM": "openclaw:tasks:" + settings["consumerName"],
    "OPENCLAW_CHAT_COMPLETIONS_URL": "http://127.0.0.1:8642/v1/chat/completions",
    "OPENCLAW_GATEWAY_TOKEN": settings["apiKey"],
}, quote=False)
subprocess.run(["docker", "rm", "-f", "gyne-hermes-consumer"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
run("docker", "run", "-d", "--restart", "unless-stopped", "--network", "host", "--name", "gyne-hermes-consumer", "--env-file", str(worker_env), "2ndbrain-gyne-consumer:hermes")
for attempt in range(30):
    running = subprocess.check_output(["docker", "inspect", "--format", "{{.State.Running}}", "gyne-hermes-consumer"], text=True).strip()
    logs = subprocess.run(["docker", "logs", "--tail", "50", "gyne-hermes-consumer"], capture_output=True, text=True)
    if running == "true" and "consumer listening for tasks" in logs.stdout + logs.stderr:
        break
    time.sleep(2)
else:
    raise RuntimeError("Gyne consumer did not connect to Redis")
print("Hermes gateway and Gyne consumer configured")
