"""
Validate Bauwerk IFC exports with IfcOpenShell, an IFC reader the agent did not write.

For every file: the IFC4 schema and its EXPRESS rules, every product's geometry built, and
every window and door filling an opening that cuts a wall. With --expect, also the counts per
storey against what the building says it should contain.

    uv run --with ifcopenshell --with pytest python scripts/validate-ifc.py docs/example-house.ifc
    uv run --with ifcopenshell --with pytest python scripts/validate-ifc.py model.ifc --expect expected.json

expected.json: {"storeys": [{"name", "walls", "windows", "doors", "spaces"}, ...]}, ground
floor first; `npm run check:ifc` writes it (pytest is what IfcOpenShell runs the
EXPRESS rules with) for the four examples. Prints every problem and
ends with "N problems"; exits 1 when there is any.
"""
import json
import sys

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.validate


def check_counts(model, expected: list[dict], problems: list[str]) -> None:
    storeys = sorted(model.by_type("IfcBuildingStorey"), key=lambda s: s.Elevation or 0.0)
    if len(storeys) != len(expected):
        problems.append(f"{len(storeys)} storeys, expected {len(expected)}")
    for storey, want in zip(storeys, expected):
        contained = [e for rel in storey.ContainsElements or [] for e in rel.RelatedElements]
        spaces = [
            o for rel in storey.IsDecomposedBy or [] for o in rel.RelatedObjects
            if o.is_a("IfcSpace")
        ]
        got = {
            "walls": sum(1 for e in contained if e.is_a("IfcWall")),
            "windows": sum(1 for e in contained if e.is_a("IfcWindow")),
            "doors": sum(1 for e in contained if e.is_a("IfcDoor")),
            "spaces": len(spaces),
        }
        for key, value in got.items():
            if value != want[key]:
                problems.append(f"{want['name']}: {value} {key}, expected {want[key]}")
        if not any(e.is_a("IfcSlab") and e.PredefinedType == "FLOOR" for e in contained):
            problems.append(f"{want['name']}: no floor slab")


def validate(path: str, expected: list[dict] | None) -> list[str]:
    problems: list[str] = []
    model = ifcopenshell.open(path)
    if model.schema != "IFC4":
        problems.append(f"schema is {model.schema}, not IFC4")

    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=True)
    for statement in logger.statements[:20]:
        message = str(statement.get("message", statement)).replace("\n", " ")[:160]
        problems.append(f"schema: {message}")

    if expected is not None:
        check_counts(model, expected, problems)

    for filler in model.by_type("IfcWindow") + model.by_type("IfcDoor"):
        fills = filler.FillsVoids or []
        opening = fills[0].RelatingOpeningElement if fills else None
        voids = opening.VoidsElements if opening else []
        if not voids or not voids[0].RelatingBuildingElement.is_a("IfcWall"):
            problems.append(f"{filler.is_a()} {filler.Name} fills no opening in a wall")

    settings = ifcopenshell.geom.settings()
    built = 0
    for product in model.by_type("IfcProduct"):
        if not product.Representation:
            continue
        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
            if len(shape.geometry.verts) == 0:
                problems.append(f"{product.is_a()} {product.Name} has empty geometry")
            built += 1
        except Exception as error:  # noqa: BLE001, the reader's own error is the message
            problems.append(f"{product.is_a()} {product.Name}: geometry fails ({str(error)[:120]})")

    for problem in problems:
        print("  ", problem)
    storeys = len(model.by_type("IfcBuildingStorey"))
    print(f"{path}: {storeys} storeys, {built} elements built, {len(problems)} problems")
    return problems


def main(args: list[str]) -> int:
    expected = None
    if "--expect" in args:
        at = args.index("--expect")
        expected = json.load(open(args[at + 1]))["storeys"]
        args = args[:at] + args[at + 2:]
    failed = False
    for path in args:
        failed = bool(validate(path, expected)) or failed
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
