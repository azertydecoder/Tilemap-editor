"""Load and validate Tilemap Studio ``faille-map`` JSON projects."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class TilemapParseError(ValueError):
    """Raised when a project file is unreadable or has an invalid structure."""


@dataclass(slots=True)
class Asset:
    id: str
    name: str
    data: bytes
    mime_type: str
    width: int = 0
    height: int = 0


@dataclass(slots=True)
class Layer:
    id: str
    name: str
    type: str
    visible: bool = True
    locked: bool = False


@dataclass(slots=True)
class EntityFieldDefinition:
    id: str
    name: str
    type: str
    default_value: Any = None


@dataclass(slots=True)
class EntityBehavior:
    type: str = "static"
    direction: str = "right"
    distance: float = 128
    speed: float = 60


@dataclass(slots=True)
class EntityImageRegion:
    x: float
    y: float
    width: float
    height: float


@dataclass(slots=True)
class MovementBehavior:
    id: str
    name: str
    type: str
    delta_x: float
    delta_y: float
    speed: float


@dataclass(slots=True)
class EntityType:
    id: str
    name: str
    color: str
    behavior: EntityBehavior = field(default_factory=EntityBehavior)
    fields: list[EntityFieldDefinition] = field(default_factory=list)
    image_asset_id: str | None = None
    image_region: EntityImageRegion | None = None


@dataclass(slots=True)
class CollisionType:
    id: str
    name: str
    color: str
    opacity: float


@dataclass(slots=True)
class Tile:
    asset_id: str
    layer_id: str
    x: float
    y: float
    source_x: float = 0
    source_y: float = 0
    source_width: float = 0
    source_height: float = 0


@dataclass(slots=True)
class MapObject:
    id: str
    kind: str
    layer_id: str
    name: str
    x: float
    y: float
    width: float
    height: float
    visible: bool = True
    asset_id: str | None = None
    entity_type_id: str | None = None
    behavior_id: str | None = None
    fields: dict[str, Any] = field(default_factory=dict)
    source_x: float = 0
    source_y: float = 0
    source_width: float = 0
    source_height: float = 0
    image_override: bool = False
    image_asset_id: str | None = None
    image_region: EntityImageRegion | None = None


@dataclass(slots=True)
class CollisionCell:
    x: float
    y: float
    layer_id: str
    type_id: str


@dataclass(slots=True)
class MapSettings:
    width: int
    height: int
    grid_size: int
    background_color: str


@dataclass(slots=True)
class Level:
    id: str
    name: str
    map: MapSettings
    layers: list[Layer] = field(default_factory=list)
    tiles: list[Tile] = field(default_factory=list)
    objects: list[MapObject] = field(default_factory=list)
    collision_types: list[CollisionType] = field(default_factory=list)
    collision_cells: list[CollisionCell] = field(default_factory=list)


@dataclass(slots=True)
class TilemapProject:
    assets: list[Asset]
    entity_types: list[EntityType]
    levels: list[Level]
    current_level_id: str
    behaviors: list[MovementBehavior] = field(default_factory=list)
    version: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def current_level(self) -> Level:
        """Return the selected level, or the first level if its ID is stale."""
        return next(
            (level for level in self.levels if level.id == self.current_level_id),
            self.levels[0],
        )

    def get_level(self, level_id: str) -> Level:
        """Return a level by ID or raise ``KeyError`` if it does not exist."""
        return next(level for level in self.levels if level.id == level_id)


def _fail(location: str, message: str) -> None:
    raise TilemapParseError(f"{location}: {message}")


def _object(value: Any, location: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(location, "expected an object")
    return value


def _array(value: Any, location: str) -> list[Any]:
    if not isinstance(value, list):
        _fail(location, "expected an array")
    return value


def _string(
    data: dict[str, Any],
    key: str,
    location: str,
    default: str | None = None,
) -> str:
    value = data.get(key, default)
    if not isinstance(value, str):
        _fail(f"{location}.{key}", "expected a string")
    return value


def _number(
    data: dict[str, Any],
    key: str,
    location: str,
    default: int | float | None = None,
) -> float:
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(f"{location}.{key}", "expected a number")
    if not math.isfinite(value):
        _fail(f"{location}.{key}", "number must be finite")
    return value


def _integer(
    data: dict[str, Any],
    key: str,
    location: str,
    default: int | None = None,
) -> int:
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(f"{location}.{key}", "expected an integer")
    return value


def _boolean(
    data: dict[str, Any],
    key: str,
    location: str,
    default: bool,
) -> bool:
    value = data.get(key, default)
    if not isinstance(value, bool):
        _fail(f"{location}.{key}", "expected a boolean")
    return value


def _unique(items: list[Any], location: str) -> None:
    seen: set[str] = set()
    for index, item in enumerate(items):
        item_location = f"{location}[{index}]"
        item = _object(item, item_location)
        identifier = _string(item, "id", item_location)
        if not identifier:
            _fail(f"{item_location}.id", "must not be empty")
        if identifier in seen:
            _fail(f"{item_location}.id", f"duplicate ID {identifier!r}")
        seen.add(identifier)


def _parse_data_url(value: Any, location: str) -> tuple[str, bytes]:
    if not isinstance(value, str) or not value.startswith("data:"):
        _fail(location, "expected an embedded base64 data URL")
    header, separator, payload = value.partition(",")
    if not separator or not header.endswith(";base64"):
        _fail(location, "expected an embedded base64 data URL")
    mime_type = header[5:-7]
    if not mime_type or not re.fullmatch(
        r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+",
        mime_type,
    ) or not mime_type.lower().startswith("image/"):
        _fail(location, "invalid image MIME type in data URL")
    try:
        data = base64.b64decode("".join(payload.split()), validate=True)
    except (binascii.Error, ValueError) as error:
        raise TilemapParseError(f"{location}: invalid base64 data ({error})") from error
    if not data:
        _fail(location, "image data must not be empty")
    return mime_type, data


def _parse_assets(root: dict[str, Any]) -> list[Asset]:
    raw_assets = _array(root.get("assets", []), "$.assets")
    _unique(raw_assets, "$.assets")
    assets: list[Asset] = []
    for index, value in enumerate(raw_assets):
        location = f"$.assets[{index}]"
        item = _object(value, location)
        mime_type, data = _parse_data_url(
            item.get("dataUrl"), f"{location}.dataUrl"
        )
        width = _integer(item, "width", location, 0)
        height = _integer(item, "height", location, 0)
        if width < 0 or height < 0:
            _fail(location, "image dimensions must not be negative")
        assets.append(
            Asset(
                id=_string(item, "id", location),
                name=_string(item, "name", location, "Image"),
                data=data,
                mime_type=mime_type,
                width=width,
                height=height,
            )
        )
    return assets


def _parse_entity_types(
    root: dict[str, Any],
    asset_ids: set[str],
) -> list[EntityType]:
    raw_types = _array(root.get("entityTypes", []), "$.entityTypes")
    _unique(raw_types, "$.entityTypes")
    entity_types: list[EntityType] = []
    for index, value in enumerate(raw_types):
        location = f"$.entityTypes[{index}]"
        item = _object(value, location)
        image_asset_id = item.get("imageAssetId")
        if image_asset_id is not None:
            if not isinstance(image_asset_id, str):
                _fail(f"{location}.imageAssetId", "expected a string or null")
            if image_asset_id not in asset_ids:
                _fail(
                    f"{location}.imageAssetId",
                    f"unknown asset ID {image_asset_id!r}",
                )
        raw_region = item.get("imageRegion")
        image_region = None
        if raw_region is not None:
            if image_asset_id is None:
                _fail(
                    f"{location}.imageRegion",
                    "requires imageAssetId",
                )
            region = _object(raw_region, f"{location}.imageRegion")
            image_region = EntityImageRegion(
                x=_number(region, "x", f"{location}.imageRegion"),
                y=_number(region, "y", f"{location}.imageRegion"),
                width=_number(region, "width", f"{location}.imageRegion"),
                height=_number(region, "height", f"{location}.imageRegion"),
            )
            if (
                image_region.x < 0
                or image_region.y < 0
                or image_region.width <= 0
                or image_region.height <= 0
            ):
                _fail(
                    f"{location}.imageRegion",
                    "coordinates must be non-negative and dimensions positive",
                )
        raw_fields = _array(item.get("fields", []), f"{location}.fields")
        _unique(raw_fields, f"{location}.fields")
        fields: list[EntityFieldDefinition] = []
        for field_index, raw_field in enumerate(raw_fields):
            field_location = f"{location}.fields[{field_index}]"
            definition = _object(raw_field, field_location)
            fields.append(
                EntityFieldDefinition(
                    id=_string(definition, "id", field_location),
                    name=_string(definition, "name", field_location, "Field"),
                    type=_string(definition, "type", field_location, "text"),
                    default_value=definition.get("defaultValue"),
                )
            )
        raw_behavior = _object(
            item.get("behavior", {}), f"{location}.behavior"
        )
        behavior_type = _string(
            raw_behavior, "type", f"{location}.behavior", "static"
        )
        if behavior_type not in {"static", "patrol"}:
            _fail(
                f"{location}.behavior.type",
                f"unsupported behavior type {behavior_type!r}",
            )
        direction = _string(
            raw_behavior, "direction", f"{location}.behavior", "right"
        )
        if direction not in {"right", "left", "up", "down"}:
            _fail(f"{location}.behavior.direction", "unsupported direction")
        distance = _number(raw_behavior, "distance", f"{location}.behavior", 128)
        speed = _number(raw_behavior, "speed", f"{location}.behavior", 60)
        if distance <= 0 or speed <= 0:
            _fail(f"{location}.behavior", "distance and speed must be positive")
        entity_types.append(
            EntityType(
                id=_string(item, "id", location),
                name=_string(item, "name", location, "Entity"),
                color=_string(item, "color", location, "#55d69e"),
                image_asset_id=image_asset_id,
                image_region=image_region,
                behavior=EntityBehavior(
                    type=behavior_type,
                    direction=direction,
                    distance=distance,
                    speed=speed,
                ),
                fields=fields,
            )
        )
    return entity_types


def _parse_movement_behaviors(root: dict[str, Any]) -> list[MovementBehavior]:
    raw_behaviors = _array(root.get("behaviors", []), "$.behaviors")
    _unique(raw_behaviors, "$.behaviors")
    behaviors: list[MovementBehavior] = []
    for index, raw_behavior in enumerate(raw_behaviors):
        location = f"$.behaviors[{index}]"
        item = _object(raw_behavior, location)
        behavior_type = _string(item, "type", location, "patrol")
        if behavior_type != "patrol":
            _fail(f"{location}.type", f"unsupported behavior type {behavior_type!r}")
        delta_x = _number(item, "deltaX", location)
        delta_y = _number(item, "deltaY", location)
        speed = _number(item, "speed", location)
        if delta_x == 0 and delta_y == 0:
            _fail(location, "deltaX and deltaY must not both be zero")
        if speed <= 0:
            _fail(f"{location}.speed", "speed must be positive")
        behaviors.append(
            MovementBehavior(
                id=_string(item, "id", location),
                name=_string(item, "name", location, "Patrol"),
                type=behavior_type,
                delta_x=delta_x,
                delta_y=delta_y,
                speed=speed,
            )
        )
    return behaviors


def _parse_level(value: Any, index: int, assets: set[str],
                 entity_type_ids: set[str], behavior_ids: set[str],
                 legacy_behavior_ids: dict[str, str]) -> Level:
    location = f"$.levels[{index}]"
    item = _object(value, location)
    raw_map = _object(item.get("map"), f"{location}.map")
    width = _integer(raw_map, "width", f"{location}.map")
    height = _integer(raw_map, "height", f"{location}.map")
    grid_size = _integer(raw_map, "gridSize", f"{location}.map")
    if width <= 0 or height <= 0 or grid_size <= 0:
        _fail(f"{location}.map", "width, height, and gridSize must be positive")
    map_settings = MapSettings(
        width=width,
        height=height,
        grid_size=grid_size,
        background_color=_string(raw_map, "bgColor", f"{location}.map", "#222222"),
    )

    raw_layers = _array(item.get("layers", []), f"{location}.layers")
    _unique(raw_layers, f"{location}.layers")
    layers: list[Layer] = []
    for layer_index, raw_layer in enumerate(raw_layers):
        layer_location = f"{location}.layers[{layer_index}]"
        layer = _object(raw_layer, layer_location)
        layers.append(
            Layer(
                id=_string(layer, "id", layer_location),
                name=_string(layer, "name", layer_location, "Layer"),
                type=_string(layer, "type", layer_location, "entities"),
                visible=_boolean(layer, "visible", layer_location, True),
                locked=_boolean(layer, "locked", layer_location, False),
            )
        )
    layer_types = {layer.id: layer.type for layer in layers}

    raw_collision_types = _array(
        item.get("collisionTypes", []), f"{location}.collisionTypes"
    )
    _unique(raw_collision_types, f"{location}.collisionTypes")
    collision_types: list[CollisionType] = []
    for type_index, raw_type in enumerate(raw_collision_types):
        type_location = f"{location}.collisionTypes[{type_index}]"
        collision_type = _object(raw_type, type_location)
        opacity = _number(collision_type, "opacity", type_location, 35)
        collision_types.append(
            CollisionType(
                id=_string(collision_type, "id", type_location),
                name=_string(collision_type, "name", type_location, "Collision"),
                color=_string(collision_type, "color", type_location, "#f44e5c"),
                opacity=max(0.0, min(100.0, opacity)),
            )
        )
    collision_type_ids = {collision_type.id for collision_type in collision_types}

    raw_tiles = _array(item.get("tiles", []), f"{location}.tiles")
    tiles: list[Tile] = []
    for tile_index, raw_tile in enumerate(raw_tiles):
        tile_location = f"{location}.tiles[{tile_index}]"
        tile = _object(raw_tile, tile_location)
        asset_id = _string(tile, "assetId", tile_location)
        layer_id = _string(tile, "layerId", tile_location)
        _check_reference(asset_id, assets, f"{tile_location}.assetId", "asset")
        _check_layer(layer_id, layer_types, "tiles", f"{tile_location}.layerId")
        tiles.append(
            Tile(
                asset_id=asset_id,
                layer_id=layer_id,
                x=_number(tile, "x", tile_location),
                y=_number(tile, "y", tile_location),
                source_x=_number(tile, "sourceX", tile_location, 0),
                source_y=_number(tile, "sourceY", tile_location, 0),
                source_width=_number(tile, "sourceWidth", tile_location, 0),
                source_height=_number(tile, "sourceHeight", tile_location, 0),
            )
        )

    raw_objects = _array(item.get("objects", []), f"{location}.objects")
    objects: list[MapObject] = []
    for object_index, raw_object in enumerate(raw_objects):
        object_location = f"{location}.objects[{object_index}]"
        obj = _object(raw_object, object_location)
        kind = _string(obj, "kind", object_location, "image")
        layer_id = _string(obj, "layerId", object_location)
        _check_layer(layer_id, layer_types, "entities", f"{object_location}.layerId")
        asset_id = obj.get("assetId")
        entity_type_id = obj.get("entityTypeId")
        if kind == "image":
            if not isinstance(asset_id, str):
                _fail(f"{object_location}.assetId", "expected an asset ID")
            _check_reference(
                asset_id, assets, f"{object_location}.assetId", "asset"
            )
        elif kind == "entity":
            if not isinstance(entity_type_id, str):
                _fail(
                    f"{object_location}.entityTypeId",
                    "expected an entity type ID",
                )
            _check_reference(
                entity_type_id,
                entity_type_ids,
                f"{object_location}.entityTypeId",
                "entity type",
            )
            behavior_id = obj.get(
                "behaviorId", legacy_behavior_ids.get(entity_type_id)
            )
            if behavior_id is not None:
                if not isinstance(behavior_id, str):
                    _fail(f"{object_location}.behaviorId", "expected a behavior ID")
                _check_reference(
                    behavior_id,
                    behavior_ids,
                    f"{object_location}.behaviorId",
                    "behavior",
                )
        else:
            _fail(f"{object_location}.kind", f"unsupported object kind {kind!r}")
        fields = obj.get("fields", {})
        if not isinstance(fields, dict):
            _fail(f"{object_location}.fields", "expected an object")
        object_width = _number(obj, "w", object_location, 1)
        object_height = _number(obj, "h", object_location, 1)
        if object_width <= 0 or object_height <= 0:
            _fail(object_location, "object width and height must be positive")
        objects.append(
            MapObject(
                id=_string(obj, "id", object_location, f"object-{object_index}"),
                kind=kind,
                layer_id=layer_id,
                name=_string(obj, "name", object_location, "Object"),
                x=_number(obj, "x", object_location),
                y=_number(obj, "y", object_location),
                width=object_width,
                height=object_height,
                visible=_boolean(obj, "visible", object_location, True),
                asset_id=asset_id,
                entity_type_id=entity_type_id,
                behavior_id=(
                    behavior_id if kind == "entity" else None
                ),
                fields=fields.copy(),
                source_x=_number(obj, "sourceX", object_location, 0),
                source_y=_number(obj, "sourceY", object_location, 0),
                source_width=_number(obj, "sourceWidth", object_location, 0),
                source_height=_number(obj, "sourceHeight", object_location, 0),
            )
        )

    raw_cells = _array(item.get("collisionCells", []), f"{location}.collisionCells")
    collision_cells: list[CollisionCell] = []
    for cell_index, raw_cell in enumerate(raw_cells):
        cell_location = f"{location}.collisionCells[{cell_index}]"
        cell = _object(raw_cell, cell_location)
        layer_id = _string(cell, "layerId", cell_location)
        type_id = _string(cell, "typeId", cell_location)
        _check_layer(
            layer_id, layer_types, "collisions", f"{cell_location}.layerId"
        )
        _check_reference(
            type_id, collision_type_ids, f"{cell_location}.typeId", "collision type"
        )
        collision_cells.append(
            CollisionCell(
                x=_number(cell, "x", cell_location),
                y=_number(cell, "y", cell_location),
                layer_id=layer_id,
                type_id=type_id,
            )
        )

    return Level(
        id=_string(item, "id", location, f"level-{index}"),
        name=_string(item, "name", location, f"Level {index + 1}"),
        map=map_settings,
        layers=layers,
        tiles=tiles,
        objects=objects,
        collision_types=collision_types,
        collision_cells=collision_cells,
    )


def _check_reference(
    identifier: str, known_ids: set[str], location: str, kind: str
) -> None:
    if identifier not in known_ids:
        _fail(location, f"unknown {kind} ID {identifier!r}")


def _check_layer(
    layer_id: str,
    layer_types: dict[str, str],
    expected_type: str,
    location: str,
) -> None:
    actual_type = layer_types.get(layer_id)
    if actual_type != expected_type:
        _fail(
            location,
            f"layer {layer_id!r} must exist and have type {expected_type!r}",
        )


def parse_project(data: Any) -> TilemapProject:
    """Parse a decoded project dictionary into typed Python objects."""
    root = _object(data, "$")
    project_format = root.get("format")
    if project_format is not None and project_format != "faille-map":
        _fail("$.format", f"unsupported project format {project_format!r}")

    assets = _parse_assets(root)
    asset_ids = {asset.id for asset in assets}
    entity_types = _parse_entity_types(root, asset_ids)
    entity_type_ids = {entity_type.id for entity_type in entity_types}
    behaviors = _parse_movement_behaviors(root)
    legacy_behavior_ids: dict[str, str] = {}
    for entity_type in entity_types:
        legacy = entity_type.behavior
        if legacy.type != "patrol":
            continue
        behavior_id = f"behavior_legacy_{entity_type.id}"
        legacy_behavior_ids[entity_type.id] = behavior_id
        if not any(behavior.id == behavior_id for behavior in behaviors):
            delta_x, delta_y = {
                "right": (legacy.distance, 0),
                "left": (-legacy.distance, 0),
                "up": (0, -legacy.distance),
                "down": (0, legacy.distance),
            }[legacy.direction]
            behaviors.append(
                MovementBehavior(
                    id=behavior_id,
                    name=f"{entity_type.name} · Patrouille",
                    type="patrol",
                    delta_x=delta_x,
                    delta_y=delta_y,
                    speed=legacy.speed,
                )
            )

    raw_levels = root.get("levels")
    has_level_array = raw_levels is not None
    if not has_level_array:
        raw_levels = [root]
    raw_levels = _array(raw_levels, "$.levels")
    if not raw_levels:
        _fail("$.levels", "project must contain at least one level")
    if has_level_array:
        _unique(raw_levels, "$.levels")
    levels = [
        _parse_level(
            value,
            index,
            asset_ids,
            entity_type_ids,
            {behavior.id for behavior in behaviors},
            legacy_behavior_ids,
        )
        for index, value in enumerate(raw_levels)
    ]

    requested_level = root.get("currentLevelId")
    current_level_id = (
        requested_level
        if isinstance(requested_level, str)
        and any(level.id == requested_level for level in levels)
        else levels[0].id
    )
    version = root.get("version")
    if version is not None and (
        isinstance(version, bool) or not isinstance(version, int)
    ):
        _fail("$.version", "expected an integer")
    metadata = root.get("metadata", {})
    if not isinstance(metadata, dict):
        _fail("$.metadata", "expected an object")

    return TilemapProject(
        assets=assets,
        entity_types=entity_types,
        levels=levels,
        current_level_id=current_level_id,
        behaviors=behaviors,
        version=version,
        metadata=metadata.copy(),
    )


def load_project(path: str | Path) -> TilemapProject:
    """Load a project JSON file and decode its embedded image assets."""
    project_path = Path(path)
    try:
        with project_path.open("r", encoding="utf-8-sig") as project_file:
            data = json.load(project_file)
    except OSError as error:
        raise TilemapParseError(f"Cannot read project {project_path}: {error}") from error
    except json.JSONDecodeError as error:
        raise TilemapParseError(
            f"Invalid JSON in {project_path} at line {error.lineno}, "
            f"column {error.colno}: {error.msg}"
        ) from error
    return parse_project(data)


def _print_summary(project: TilemapProject) -> None:
    print(
        f"Loaded {len(project.levels)} level(s), {len(project.assets)} asset(s), "
        f"{len(project.entity_types)} entity type(s)."
    )
    for index, level in enumerate(project.levels):
        print(
            f"  [{index}] {level.name} — {level.map.width}x{level.map.height}, "
            f"{len(level.tiles)} tile(s), {len(level.objects)} object(s), "
            f"{len(level.collision_cells)} collision cell(s)"
        )


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point for validating and summarizing a map."""
    parser = argparse.ArgumentParser(
        description="Load and validate a Tilemap Studio faille-map project."
    )
    parser.add_argument("project", type=Path, help="path to the project JSON file")
    arguments = parser.parse_args(argv)
    try:
        project = load_project(arguments.project)
    except TilemapParseError as error:
        print(f"Could not load project: {error}", file=sys.stderr)
        return 1
    _print_summary(project)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
