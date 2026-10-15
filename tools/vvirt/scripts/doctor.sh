#!/usr/bin/env bash
# vvirt readiness check (read-only). usage: doctor.sh [--json] [--no-roundtrip]
exec bash "$(dirname "$0")/pyrun.sh" -m vvirt.doctor "$@"
