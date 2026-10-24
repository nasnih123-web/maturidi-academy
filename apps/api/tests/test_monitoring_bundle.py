"""تست m-02: اعتبارسنجی استاتیک bundle مانیتورینگ infra/monitoring.

اجرای زندهٔ compose در سندباکس ممکن نیست (بدون Docker) — این تست
هرچه را می‌شود ایستا ثابت کرد، ثابت می‌کند: فایل‌ها parse می‌شوند،
داشبوردها به دیتاسورس‌های provisionشده ارجاع می‌دهند، و متریک‌هایی
که قوانین هشدار استفاده می‌کنند واقعاً در exposition API هستند.
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
MON = ROOT / "infra" / "monitoring"


def _load_yaml(p: Path):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def test_prometheus_config_and_rules_parse():
    cfg = _load_yaml(MON / "prometheus.yml")
    jobs = {j["job_name"] for j in cfg["scrape_configs"]}
    assert jobs == {"maturidi-api", "node", "postgres"}
    assert cfg["rule_files"] == ["/etc/prometheus/alerts.yml"]
    alerts = _load_yaml(MON / "alerts.yml")
    names = {
        r["alert"] for g in alerts["groups"] for r in g["rules"]
    }
    assert names == {
        "High5xxRate",
        "OutboxQueueLag",
        "OutboxDeadLetterGrowing",
        "DiskSpaceLow",
        "ApiDown",
    }


def test_alert_metrics_exist_in_api_exposition():
    from app.core.metrics import METRICS

    METRICS.set_outbox_stats(3, 42.0, 1)
    text = METRICS.exposition()
    for metric in (
        "http_requests_total",
        "outbox_pending_events",
        "outbox_oldest_pending_age_seconds",
        "outbox_dead_letter_events",
    ):
        assert metric in text


def test_grafana_provisioning_and_dashboards():
    ds = _load_yaml(
        MON / "grafana/provisioning/datasources/datasources.yml"
    )
    uids = {d["uid"] for d in ds["datasources"]}
    assert uids == {"prometheus", "loki"}
    prov = _load_yaml(
        MON / "grafana/provisioning/dashboards/dashboards.yml"
    )
    assert prov["providers"][0]["options"]["path"] == "/etc/grafana/dashboards"
    dashboards = sorted((MON / "grafana/dashboards").glob("*.json"))
    titles = set()
    for path in dashboards:
        doc = json.loads(path.read_text(encoding="utf-8"))
        titles.add(doc["uid"])
        for panel in doc["panels"]:
            assert panel["datasource"]["uid"] in uids, (path.name, panel)
            assert panel["targets"], (path.name, panel)
    assert titles == {
        "maturidi-api",
        "maturidi-queues",
        "maturidi-database",
        "maturidi-errors",
    }


def test_loki_and_promtail_configs_parse():
    loki = _load_yaml(MON / "loki/local-config.yaml")
    assert loki["server"]["http_listen_port"] == 3100
    assert loki["limits_config"]["retention_period"] == "336h"
    promtail = _load_yaml(MON / "promtail/config.yml")
    assert promtail["clients"][0]["url"].endswith("loki:3100/loki/api/v1/push")
    assert promtail["scrape_configs"][0]["job_name"] == "docker"


def test_compose_wires_monitoring_services():
    compose = _load_yaml(ROOT / "docker-compose.prod.yml")
    services = compose["services"]
    for name in ("prometheus", "grafana", "loki", "promtail",
                 "node-exporter", "postgres-exporter"):
        assert name in services, name
    grafana_volumes = " ".join(services["grafana"]["volumes"])
    assert "provisioning" in grafana_volumes
    assert "dashboards" in grafana_volumes
    loki_volumes = " ".join(services["loki"]["volumes"])
    assert "local-config.yaml" in loki_volumes
    prom_volumes = " ".join(services["prometheus"]["volumes"])
    assert "alerts.yml" in prom_volumes
