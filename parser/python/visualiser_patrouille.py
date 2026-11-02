"""Animate a patrol entity from a Tilemap Studio project."""

from __future__ import annotations

import argparse
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path

if __package__:
    from .tilemap_parser import (
        MapObject,
        TilemapParseError,
        TilemapProject,
        load_project,
    )
else:
    from tilemap_parser import (
        MapObject,
        TilemapParseError,
        TilemapProject,
        load_project,
    )


EXAMPLE_PROJECT = Path(__file__).parent / "examples" / "plateforme-patrouille.json"
@dataclass(slots=True)
class PatrolMotion:
    """Position of an entity patrolling along an X/Y line segment."""

    start_x: float
    start_y: float
    delta_x: float
    delta_y: float
    speed: float
    progress: float = 0
    travel_direction: int = 1

    def __post_init__(self) -> None:
        if not math.isfinite(self.delta_x) or not math.isfinite(self.delta_y):
            raise ValueError("Patrol X/Y displacement must be finite.")
        if self.delta_x == 0 and self.delta_y == 0:
            raise ValueError("Patrol must have a non-zero X or Y displacement.")
        if not math.isfinite(self.speed) or self.speed <= 0:
            raise ValueError("Patrol speed must be a positive finite number.")
        if not 0 <= self.progress <= self.distance:
            raise ValueError("Patrol progress must be within its path.")
        if self.travel_direction not in {-1, 1}:
            raise ValueError("Travel direction must be -1 or 1.")

    @property
    def position(self) -> tuple[float, float]:
        ratio = self.progress / self.distance
        return (
            self.start_x + self.delta_x * ratio,
            self.start_y + self.delta_y * ratio,
        )

    @property
    def distance(self) -> float:
        return math.hypot(self.delta_x, self.delta_y)

    @property
    def endpoint(self) -> tuple[float, float]:
        return (
            self.start_x + self.delta_x,
            self.start_y + self.delta_y,
        )

    def advance(self, elapsed_seconds: float) -> tuple[float, float]:
        """Advance by elapsed time, reflecting at both ends of the path."""
        if not math.isfinite(elapsed_seconds) or elapsed_seconds < 0:
            raise ValueError("Elapsed time must be a non-negative finite number.")

        period = 2 * self.distance
        phase = self.progress if self.travel_direction == 1 else (
            period - self.progress
        )
        phase = (phase + self.speed * elapsed_seconds) % period

        if phase < self.distance:
            self.progress = phase
            self.travel_direction = 1
        elif phase > self.distance:
            self.progress = period - phase
            self.travel_direction = -1
        else:
            self.progress = self.distance
            self.travel_direction = -1
        return self.position

    def reset(self) -> None:
        self.progress = 0
        self.travel_direction = 1


def find_patrol_entity(
    project: TilemapProject, entity_id: str | None = None
) -> tuple[MapObject, int]:
    """Find an entity assigned a reusable patrol behavior."""
    behavior_ids = {behavior.id for behavior in project.behaviors}
    candidates = [
        (level, obj)
        for level in project.levels
        for obj in level.objects
        if obj.kind == "entity"
        and (entity_id is None or obj.id == entity_id)
        and obj.behavior_id in behavior_ids
    ]
    if not candidates:
        if entity_id is not None:
            raise ValueError(
                f"No entity with ID {entity_id!r} has an assigned patrol behavior."
            )
        raise ValueError(
            "This project has no entity assigned to a patrol behavior. "
            "Assign a reusable movement behavior or use the included example."
        )

    level, entity = candidates[0]
    return entity, level.map.grid_size


def make_patrol_motion(
    project: TilemapProject, entity: MapObject
) -> PatrolMotion:
    """Create a motion simulation from the entity's assigned behavior."""
    behavior = next(
        (
            candidate
            for candidate in project.behaviors
            if candidate.id == entity.behavior_id
        ),
        None,
    )
    if behavior is None or behavior.type != "patrol":
        raise ValueError(
            f"Entity {entity.id!r} is not assigned a patrol behavior."
        )
    return PatrolMotion(
        start_x=entity.x + entity.width / 2,
        start_y=entity.y + entity.height / 2,
        delta_x=behavior.delta_x,
        delta_y=behavior.delta_y,
        speed=behavior.speed,
    )


def _valid_color(color: str) -> str:
    if (
        len(color) == 7
        and color.startswith("#")
        and all(character in "0123456789abcdefABCDEF" for character in color[1:])
    ):
        return color
    return "#55d69e"


def _run_viewer(project: TilemapProject, entity_id: str | None) -> None:
    try:
        import tkinter as tk
    except ImportError as error:
        raise RuntimeError(
            "Tkinter n'est pas disponible dans cette installation de Python."
        ) from error

    entity, grid_size = find_patrol_entity(project, entity_id)
    level = next(
        level for level in project.levels
        if any(candidate.id == entity.id for candidate in level.objects)
    )
    motion = make_patrol_motion(project, entity)
    entity_type = next(
        candidate for candidate in project.entity_types
        if candidate.id == entity.entity_type_id
    )
    try:
        root = tk.Tk()
    except tk.TclError as error:
        raise RuntimeError(f"Impossible d’ouvrir la fenêtre Tkinter : {error}") from error
    root.title("Exemple — déplacement XY")
    root.geometry("1000x640")
    root.minsize(520, 380)
    root.configure(background="#171e25")

    heading = tk.Label(
        root,
        text=f"{entity.name}  ·  {entity_type.name}",
        bg="#171e25",
        fg="#e5ecef",
        font=("Segoe UI", 14, "bold"),
        padx=14,
        pady=10,
    )
    heading.pack(anchor="w")
    canvas = tk.Canvas(
        root,
        background=level.map.background_color,
        highlightthickness=0,
    )
    canvas.pack(fill="both", expand=True, padx=12)
    status = tk.StringVar()
    footer = tk.Label(
        root,
        textvariable=status,
        bg="#171e25",
        fg="#b5c1c7",
        font=("Segoe UI", 10),
        padx=14,
        pady=9,
    )
    footer.pack(fill="x")
    controls = tk.Label(
        root,
        text="Espace : pause / reprendre    R : recommencer    Échap : quitter",
        bg="#171e25",
        fg="#84939a",
        font=("Segoe UI", 9),
        padx=14,
        pady=2,
    )
    controls.pack(fill="x")

    paused = False
    last_frame = time.perf_counter()
    entity_color = _valid_color(entity_type.color)
    background_color = _valid_color(level.map.background_color)

    def draw() -> None:
        canvas.delete("all")
        canvas_width = max(canvas.winfo_width(), 1)
        canvas_height = max(canvas.winfo_height(), 1)
        scale = min(
            canvas_width / level.map.width,
            canvas_height / level.map.height,
        )
        offset_x = (canvas_width - level.map.width * scale) / 2
        offset_y = (canvas_height - level.map.height * scale) / 2

        def screen(point_x: float, point_y: float) -> tuple[float, float]:
            return offset_x + point_x * scale, offset_y + point_y * scale

        map_right = offset_x + level.map.width * scale
        map_bottom = offset_y + level.map.height * scale
        canvas.create_rectangle(
            offset_x,
            offset_y,
            map_right,
            map_bottom,
            fill=background_color,
            outline="#3c4c59",
        )

        if scale >= 0.45:
            for x in range(0, level.map.width + 1, grid_size):
                screen_x, _ = screen(x, 0)
                canvas.create_line(
                    screen_x, offset_y, screen_x, map_bottom,
                    fill="#263546",
                )
            for y in range(0, level.map.height + 1, grid_size):
                _, screen_y = screen(0, y)
                canvas.create_line(
                    offset_x, screen_y, map_right, screen_y,
                    fill="#263546",
                )

        start_screen = screen(motion.start_x, motion.start_y)
        end_screen = screen(*motion.endpoint)
        current_screen = screen(*motion.position)
        half_width = entity.width * scale / 2
        half_height = entity.height * scale / 2
        canvas.create_line(
            *start_screen,
            *end_screen,
            fill="#7ee0c1",
            width=2,
            dash=(8, 5),
        )
        canvas.create_oval(
            start_screen[0] - 5, start_screen[1] - 5,
            start_screen[0] + 5, start_screen[1] + 5,
            fill="#7ee0c1", outline="",
        )
        canvas.create_rectangle(
            end_screen[0] - half_width, end_screen[1] - half_height,
            end_screen[0] + half_width, end_screen[1] + half_height,
            outline="#7ee0c1",
            dash=(5, 4),
            width=2,
        )
        canvas.create_rectangle(
            current_screen[0] - half_width, current_screen[1] - half_height,
            current_screen[0] + half_width, current_screen[1] + half_height,
            fill=entity_color,
            outline="#d6fff0",
            width=2,
        )
        status.set(
            f"{level.name}  ·  ΔX : {motion.delta_x:g}px  ·  "
            f"ΔY : {motion.delta_y:g}px  ·  "
            f"Vitesse : {motion.speed:g} px/s  ·  "
            f"Trajet : {motion.distance:g} px  ·  "
            f"Position : ({motion.position[0]:.0f}, {motion.position[1]:.0f})"
            + ("  ·  En pause" if paused else "")
        )

    def tick() -> None:
        nonlocal last_frame
        now = time.perf_counter()
        elapsed = min(now - last_frame, 0.1)
        last_frame = now
        if not paused:
            motion.advance(elapsed)
        draw()
        root.after(16, tick)

    def toggle_pause(_event: object = None) -> None:
        nonlocal paused, last_frame
        paused = not paused
        last_frame = time.perf_counter()
        draw()

    def reset(_event: object = None) -> None:
        nonlocal last_frame
        motion.reset()
        last_frame = time.perf_counter()
        draw()

    root.bind("<space>", toggle_pause)
    root.bind("<r>", reset)
    root.bind("<Escape>", lambda _event: root.destroy())
    canvas.bind("<Configure>", lambda _event: draw())
    root.after(16, tick)
    root.mainloop()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Visualiser une entité en patrouille aller-retour."
    )
    parser.add_argument(
        "project",
        nargs="?",
        type=Path,
        default=EXAMPLE_PROJECT,
        help="projet JSON exporté (par défaut : exemple inclus)",
    )
    parser.add_argument(
        "--entity",
        dest="entity_id",
        help="ID de l'entité en patrouille à afficher",
    )
    arguments = parser.parse_args(argv)

    try:
        project = load_project(arguments.project)
        find_patrol_entity(project, arguments.entity_id)
        _run_viewer(project, arguments.entity_id)
    except (TilemapParseError, ValueError, RuntimeError) as error:
        print(f"Impossible de lancer l’exemple : {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
