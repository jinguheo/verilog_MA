from capabilities import CAPABILITIES


def detect_gaps(results):
    """Attach explicit gap information without pretending planned work ran."""
    by_name = {item.get("agent"): item for item in results}
    report = []
    for name, capability in CAPABILITIES.items():
        observed = by_name.get(name)
        report.append({
            "component": name,
            "status": capability["status"],
            "executed": observed is not None,
            "implemented": capability["implemented"],
            "missing": capability["missing"],
            "external_required": capability["external_required"],
        })
    return report
