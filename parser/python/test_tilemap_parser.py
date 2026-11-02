import base64
import tempfile
import unittest
from pathlib import Path

from tilemap_parser import TilemapParseError, load_project, parse_project
from visualiser_patrouille import (
    PatrolMotion,
    find_patrol_entity,
    make_patrol_motion,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class TilemapParserTests(unittest.TestCase):
    def test_loads_single_level_export_with_embedded_image(self) -> None:
        project = load_project(
            PROJECT_ROOT / "test" / "test 1" / "tilemap-studio (1).json"
        )

        self.assertEqual(len(project.levels), 1)
        self.assertEqual(project.current_level.name, "Niveau 1")
        self.assertEqual(project.current_level.map.width, 1600)
        self.assertEqual(len(project.assets), 1)
        self.assertEqual(project.assets[0].mime_type, "image/png")
        self.assertTrue(project.assets[0].data.startswith(b"\x89PNG"))
        self.assertEqual(len(project.current_level.objects), 3)
        self.assertEqual(len(project.current_level.collision_cells), 166)

    def test_loads_multiple_levels_entities_and_embedded_images(self) -> None:
        project = load_project(PROJECT_ROOT / "test" / "map-mondes.json")

        self.assertEqual(len(project.levels), 3)
        self.assertEqual(len(project.assets), 3)
        self.assertEqual(project.current_level.name, "Caverne des cristaux")
        self.assertEqual(project.entity_types[0].fields[0].default_value, "right")
        self.assertEqual(project.entity_types[0].behavior.type, "static")
        spawn = next(
            obj for obj in project.levels[0].objects if obj.kind == "entity"
        )
        self.assertEqual(spawn.fields, {"direction": "right"})
        self.assertEqual(len(project.levels[0].collision_cells), 50)

    def test_accepts_legacy_single_level_shape(self) -> None:
        raw = {
            "assets": [
                {
                    "id": "asset",
                    "name": "pixel.png",
                    "dataUrl": "data:image/png;base64,"
                    + base64.b64encode(b"image-bytes").decode("ascii"),
                    "width": 1,
                    "height": 1,
                }
            ],
            "entityTypes": [],
            "map": {"width": 64, "height": 32, "gridSize": 16},
            "layers": [{"id": "tiles", "type": "tiles"}],
            "tiles": [
                {
                    "assetId": "asset",
                    "layerId": "tiles",
                    "x": 16,
                    "y": 0,
                    "sourceX": 4,
                    "sourceY": 8,
                    "sourceWidth": 12,
                    "sourceHeight": 10,
                }
            ],
            "objects": [],
            "collisionTypes": [],
            "collisionCells": [],
        }

        project = parse_project(raw)

        self.assertEqual(project.levels[0].map.width, 64)
        self.assertEqual(project.assets[0].data, b"image-bytes")
        self.assertEqual(project.levels[0].tiles[0].source_width, 12)

    def test_parses_entity_patrol_behavior(self) -> None:
        project = parse_project({
            "entityTypes": [{
                "id": "moving-platform",
                "name": "Plateforme mobile",
                "behavior": {
                    "type": "patrol",
                    "direction": "left",
                    "distance": 240,
                    "speed": 75,
                },
            }],
            "levels": [{
                "id": "level",
                "name": "Level",
                "map": {"width": 64, "height": 32, "gridSize": 16},
                "layers": [],
                "tiles": [],
                "objects": [],
                "collisionTypes": [],
                "collisionCells": [],
            }],
        })

        behavior = project.entity_types[0].behavior
        self.assertEqual(behavior.type, "patrol")
        self.assertEqual(behavior.direction, "left")
        self.assertEqual(behavior.distance, 240)
        self.assertEqual(behavior.speed, 75)

    def test_parses_entity_type_image_and_sprite_region(self) -> None:
        project = parse_project({
            "assets": [{
                "id": "platform-sheet",
                "name": "platform.png",
                "dataUrl": "data:image/png;base64,cGl4ZWw=",
                "width": 64,
                "height": 32,
            }],
            "entityTypes": [{
                "id": "platform",
                "name": "Platform",
                "imageAssetId": "platform-sheet",
                "imageRegion": {
                    "x": 16,
                    "y": 8,
                    "width": 32,
                    "height": 16,
                },
            }],
            "levels": [{
                "id": "level",
                "name": "Level",
                "map": {"width": 64, "height": 32, "gridSize": 16},
                "layers": [],
                "tiles": [],
                "objects": [],
                "collisionTypes": [],
                "collisionCells": [],
            }],
        })

        entity_type = project.entity_types[0]
        self.assertEqual(entity_type.image_asset_id, "platform-sheet")
        self.assertEqual(
            (
                entity_type.image_region.x,
                entity_type.image_region.y,
                entity_type.image_region.width,
                entity_type.image_region.height,
            ),
            (16, 8, 32, 16),
        )

    def test_patrol_example_moves_right_then_left(self) -> None:
        example_path = (
            Path(__file__).resolve().parent
            / "examples"
            / "plateforme-patrouille.json"
        )
        project = load_project(example_path)
        entity, _grid_size = find_patrol_entity(project)
        motion = make_patrol_motion(project, entity)

        self.assertEqual(motion.position, (208, 232))
        self.assertEqual(motion.distance, 300)
        self.assertEqual(motion.advance(1), (268, 277))
        self.assertEqual(motion.advance(3), (448, 412))
        self.assertEqual(motion.advance(1), (388, 367))

    def test_patrol_motion_handles_multiple_bounces(self) -> None:
        motion = PatrolMotion(
            start_x=10,
            start_y=20,
            delta_x=100,
            delta_y=0,
            speed=50,
        )

        self.assertEqual(motion.advance(5), (60, 20))
        motion.reset()
        self.assertEqual(motion.position, (10, 20))

    def test_migrates_legacy_patrol_and_assigns_entity(self) -> None:
        project = parse_project({
            "entityTypes": [{
                "id": "platform",
                "name": "Platform",
                "behavior": {
                    "type": "patrol",
                    "direction": "up",
                    "distance": 64,
                    "speed": 32,
                },
            }],
            "levels": [{
                "id": "level",
                "name": "Level",
                "map": {"width": 64, "height": 64, "gridSize": 16},
                "layers": [{"id": "entities", "type": "entities"}],
                "tiles": [],
                "objects": [{
                    "id": "platform-instance",
                    "kind": "entity",
                    "entityTypeId": "platform",
                    "layerId": "entities",
                    "x": 8,
                    "y": 8,
                    "w": 16,
                    "h": 16,
                }],
                "collisionTypes": [],
                "collisionCells": [],
            }],
        })
        entity = project.current_level.objects[0]
        motion = make_patrol_motion(project, entity)

        self.assertEqual(entity.behavior_id, "behavior_legacy_platform")
        self.assertEqual(motion.endpoint, (16, -48))
        self.assertEqual(motion.speed, 32)

    def test_explicitly_unassigned_entity_does_not_migrate_legacy_behavior(self) -> None:
        project = parse_project({
            "entityTypes": [{
                "id": "platform",
                "behavior": {
                    "type": "patrol",
                    "direction": "right",
                    "distance": 32,
                    "speed": 16,
                },
            }],
            "levels": [{
                "id": "level",
                "name": "Level",
                "map": {"width": 64, "height": 64, "gridSize": 16},
                "layers": [{"id": "entities", "type": "entities"}],
                "tiles": [],
                "objects": [{
                    "id": "platform-instance",
                    "kind": "entity",
                    "entityTypeId": "platform",
                    "behaviorId": None,
                    "layerId": "entities",
                    "x": 8,
                    "y": 8,
                    "w": 16,
                    "h": 16,
                }],
                "collisionTypes": [],
                "collisionCells": [],
            }],
        })
        entity = project.current_level.objects[0]

        self.assertIsNone(entity.behavior_id)
        with self.assertRaisesRegex(ValueError, "not assigned"):
            make_patrol_motion(project, entity)

    def test_rejects_unknown_asset_reference(self) -> None:
        raw = {
            "format": "faille-map",
            "assets": [],
            "entityTypes": [],
            "levels": [
                {
                    "id": "level",
                    "name": "Level",
                    "map": {"width": 32, "height": 32, "gridSize": 16},
                    "layers": [{"id": "tiles", "type": "tiles"}],
                    "tiles": [
                        {
                            "assetId": "missing",
                            "layerId": "tiles",
                            "x": 0,
                            "y": 0,
                        }
                    ],
                    "objects": [],
                    "collisionTypes": [],
                    "collisionCells": [],
                }
            ],
        }

        with self.assertRaisesRegex(TilemapParseError, "unknown asset ID"):
            parse_project(raw)

    def test_rejects_invalid_data_url(self) -> None:
        raw = {
            "assets": [
                {"id": "asset", "name": "bad.png", "dataUrl": "data:image/png;base64,%%%"}
            ],
            "entityTypes": [],
            "levels": [],
        }

        with self.assertRaisesRegex(TilemapParseError, "invalid base64"):
            parse_project(raw)

    def test_load_project_reports_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_path = Path(directory) / "broken.json"
            project_path.write_text("{broken", encoding="utf-8")

            with self.assertRaisesRegex(TilemapParseError, "Invalid JSON"):
                load_project(project_path)


if __name__ == "__main__":
    unittest.main()
