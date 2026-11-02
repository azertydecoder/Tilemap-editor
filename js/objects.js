
import { state, uid, entityImageSize } from "./state.js";
import { render, screenToMap, canvas } from "./renderer.js";
import { saveHistory, refreshUI, selectObject } from "./main.js";
import {
    getSelectedSheetTile,
    selectSheetTile
} from "./spritesheet.js";

export function addAsset(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith("image/")) {
            reject(new Error("Ce fichier n'est pas une image."));
            return;
        }

        const reader = new FileReader();

        reader.onerror = () => {
            reject(new Error("Lecture du fichier impossible."));
        };

        reader.onload = () => {
            const img = new Image();

            img.onload = () => {
                const asset = {
                    id: `asset_${Date.now()}_${Math.random()
                        .toString(36).slice(2, 7)}`,
                    name: file.name,
                    dataUrl: reader.result,
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    img
                };

                state.assets.push(asset);
                resolve(asset);
            };

            img.onerror = () => {
                reject(new Error("Image illisible."));
            };

            img.src = reader.result;
        };

        reader.readAsDataURL(file);
    });
}

export function placeAsset(asset, x, y) {
    return placeAssetRegion(asset, null, x, y);
}

export function placeAssetRegion(asset, region, x, y) {
    const layer = state.layers.find(item => item.id === state.activeLayerId);
    if (!layer || layer.type !== "entities" || layer.locked) return null;

    const obj = {
        id: uid(),
        assetId: asset.id,
        layerId: layer.id,
        kind: "image",
        name: region
            ? `${asset.name.replace(/\.[^.]+$/, "")} (découpe)`
            : asset.name.replace(/\.[^.]+$/, ""),
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(1, region?.width || asset.width),
        h: Math.max(1, region?.height || asset.height),
        visible: true
    };

    if (region) {
        obj.sourceX = region.x;
        obj.sourceY = region.y;
        obj.sourceWidth = region.width;
        obj.sourceHeight = region.height;
    }

    if (state.snap) {
        obj.x = snap(obj.x);
        obj.y = snap(obj.y);
    }

    state.objects.push(obj);
    selectObject(obj.id);
    saveHistory();
    refreshUI();
    render();

    return obj;
}

export function placeAnimation(animation, x, y) {
    const layer = state.layers.find(item => item.id === state.activeLayerId);
    if (!layer || layer.type !== "entities" || layer.locked) return null;

    const firstFrame = animation.frames[0];
    const asset = state.assets.find(item => item.id === firstFrame?.assetId);
    if (!asset) return null;

    const object = {
        id: uid(),
        assetId: asset.id,
        animationId: animation.id,
        layerId: layer.id,
        kind: "image",
        name: animation.name,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(1, asset.width),
        h: Math.max(1, asset.height),
        visible: true
    };

    if (state.snap) {
        object.x = snap(object.x);
        object.y = snap(object.y);
    }

    state.objects.push(object);
    selectObject(object.id);
    saveHistory();
    refreshUI();
    render();
    return object;
}

export function placeEntity(x, y) {
    const layer = state.layers.find(item => item.id === state.activeLayerId);
    const type = state.entityTypes.find(
        item => item.id === state.selectedEntityTypeId
    );
    if (!layer || layer.type !== "entities" || layer.locked || !type) return null;

    const { width, height } = entityImageSize(
        type,
        state.assets,
        state.gridSize
    );
    const entity = {
        id: uid(),
        kind: "entity",
        entityTypeId: type.id,
        behaviorId: state.selectedBehaviorId || null,
        fields: Object.fromEntries(type.fields.map(field => [
            field.id,
            field.defaultValue ?? (
                field.type === "number" ? 0 :
                field.type === "boolean" ? false :
                field.type === "direction" ? "right" : ""
            )
        ])),
        layerId: layer.id,
        name: type.name,
        x: Math.round((state.snap ? snap(x) : x) - width / 2),
        y: Math.round((state.snap ? snap(y) : y) - height / 2),
        w: width,
        h: height,
        visible: true
    };
    state.objects.push(entity);
    selectObject(entity.id);
    saveHistory();
    refreshUI();
    render();
    return entity;
}

function snap(value) {
    return Math.round(value / state.gridSize) * state.gridSize;
}

function hitObject(x, y) {
    return [...state.objects].reverse().find(object =>
        object.layerId === state.activeLayerId &&
        state.layers.find(layer => layer.id === object.layerId)?.visible &&
        !state.layers.find(layer => layer.id === object.layerId)?.locked &&
        object.visible &&
        x >= object.x &&
        x <= object.x + object.w &&
        y >= object.y &&
        y <= object.y + object.h
    );
}

const resizeHandles = [
    { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
    { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
    { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
    { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
    { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
    { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
    { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
    { id: "w", x: 0, y: 0.5, cursor: "ew-resize" }
];

function handlePosition(object, handle) {
    return {
        x: object.x + object.w * handle.x,
        y: object.y + object.h * handle.y
    };
}

function hitHandle(object, x, y) {
    return resizeHandles.find(handle => {
        const position = handlePosition(object, handle);
        return Math.abs(x - position.x) <= 9 &&
            Math.abs(y - position.y) <= 9;
    })?.id || null;
}

function resizeObject(object, dx, dy, handle, preserveRatio) {
    const original = state.objectStart;
    let left = original.x;
    let right = original.x + original.w;
    let top = original.y;
    let bottom = original.y + original.h;
    const movesWest = handle.includes("w");
    const movesEast = handle.includes("e");
    const movesNorth = handle.includes("n");
    const movesSouth = handle.includes("s");

    if (movesWest) left += dx;
    if (movesEast) right += dx;
    if (movesNorth) top += dy;
    if (movesSouth) bottom += dy;

    if (preserveRatio && (movesWest || movesEast) && (movesNorth || movesSouth)) {
        const ratio = original.w / original.h;
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);
        const widthChange = Math.abs(width - original.w) / original.w;
        const heightChange = Math.abs(height - original.h) / original.h;

        if (widthChange >= heightChange) {
            const adjustedHeight = width / ratio;
            if (movesNorth) top = bottom - adjustedHeight;
            else bottom = top + adjustedHeight;
        } else {
            const adjustedWidth = height * ratio;
            if (movesWest) left = right - adjustedWidth;
            else right = left + adjustedWidth;
        }
    }

    if (right - left < 1) {
        if (movesWest) left = right - 1;
        else right = left + 1;
    }
    if (bottom - top < 1) {
        if (movesNorth) top = bottom - 1;
        else bottom = top + 1;
    }

    if (state.snap) {
        if (movesWest) left = Math.min(right - state.gridSize, snap(left));
        if (movesEast) right = Math.max(left + state.gridSize, snap(right));
        if (movesNorth) top = Math.min(bottom - state.gridSize, snap(top));
        if (movesSouth) bottom = Math.max(top + state.gridSize, snap(bottom));
    }

    object.x = left;
    object.y = top;
    object.w = right - left;
    object.h = bottom - top;
}

function cellCoordinates(x, y) {
    return {
        x: Math.floor(x / state.gridSize) * state.gridSize,
        y: Math.floor(y / state.gridSize) * state.gridSize
    };
}

function tileRegion(tile) {
    return {
        sourceX: tile?.sourceX || 0,
        sourceY: tile?.sourceY || 0,
        sourceWidth: tile?.sourceWidth || 0,
        sourceHeight: tile?.sourceHeight || 0
    };
}

function regionMatches(tile, assetId, region) {
    const current = tileRegion(tile);
    return tile?.assetId === assetId &&
        current.sourceX === region.sourceX &&
        current.sourceY === region.sourceY &&
        current.sourceWidth === region.sourceWidth &&
        current.sourceHeight === region.sourceHeight;
}

function selectedPaintTile() {
    const selection = getSelectedSheetTile();
    const asset = selection?.asset || state.assets.find(
        item => item.id === state.selectedTileAssetId
    );
    if (!asset) return null;

    return {
        assetId: asset.id,
        sourceX: selection?.x || 0,
        sourceY: selection?.y || 0,
        sourceWidth: selection?.width || 0,
        sourceHeight: selection?.height || 0
    };
}

function paintCell(
    x,
    y,
    { erase = false, collision = false, visited = null } = {}
) {
    const layer = state.layers.find(item => item.id === state.activeLayerId);
    if (!layer || layer.locked) return false;
    if (collision ? layer.type !== "collisions" : layer.type !== "tiles") {
        return false;
    }

    const { x: tx, y: ty } = cellCoordinates(x, y);
    if (tx < 0 || ty < 0 || tx >= state.mapWidth || ty >= state.mapHeight) {
        return false;
    }

    const key = `${tx},${ty}`;
    if (visited?.has(key)) return false;
    visited?.add(key);

    if (collision) {
        const index = state.collisionCells.findIndex(
            cell => cell.layerId === layer.id && cell.x === tx && cell.y === ty
        );
        if (erase) {
            if (index < 0) return false;
            state.collisionCells.splice(index, 1);
            return true;
        }

        if (!state.collisionTypes.some(
            type => type.id === state.selectedCollisionTypeId
        )) return false;

        if (index >= 0) {
            if (
                state.collisionCells[index].typeId ===
                state.selectedCollisionTypeId
            ) {
                return false;
            }
            state.collisionCells[index].typeId = state.selectedCollisionTypeId;
            return true;
        }

        state.collisionCells.push({
            x: tx,
            y: ty,
            layerId: layer.id,
            typeId: state.selectedCollisionTypeId
        });
        return true;
    }

    const index = state.tiles.findIndex(
        tile => tile.layerId === layer.id && tile.x === tx && tile.y === ty
    );

    if (erase) {
        if (index < 0) return false;
        state.tiles.splice(index, 1);
        return true;
    }

    const paintTile = selectedPaintTile();
    if (!paintTile) return false;

    if (index >= 0) {
        const tile = state.tiles[index];
        if (regionMatches(tile, paintTile.assetId, paintTile)) return false;
        Object.assign(tile, paintTile);
        return true;
    }

    state.tiles.push({
        ...paintTile,
        layerId: layer.id,
        x: tx,
        y: ty
    });
    return true;
}

function paintBrushAt(x, y, erase = false, collision = false) {
    const size = Math.max(1, Math.min(16, Math.floor(state.brushSize) || 1));
    const center = cellCoordinates(x, y);
    const offset = Math.floor((size - 1) / 2);
    let changed = false;

    for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
            changed = paintCell(
                center.x + (column - offset) * state.gridSize,
                center.y + (row - offset) * state.gridSize,
                { erase, collision, visited: state.paintVisitedCells }
            ) || changed;
        }
    }

    if (changed) render();
}

function paintStrokeTo(point, erase = false, collision = false) {
    const previous = state.lastPaintCell;
    if (!previous) {
        paintBrushAt(point.x, point.y, erase, collision);
        state.lastPaintCell = point;
        return;
    }

    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / state.gridSize)
    );

    for (let step = 1; step <= steps; step++) {
        const progress = step / steps;
        paintBrushAt(
            previous.x + dx * progress,
            previous.y + dy * progress,
            erase,
            collision
        );
    }
    state.lastPaintCell = point;
}

function fillContiguousAt(x, y) {
    const layer = state.layers.find(item => item.id === state.activeLayerId);
    if (!layer || layer.type !== "tiles" || layer.locked) return;
    const paintTile = selectedPaintTile();
    if (!paintTile) {
        alert("Choisis une tuile ou une découpe dans la palette.");
        return;
    }

    const columns = Math.ceil(state.mapWidth / state.gridSize);
    const rows = Math.ceil(state.mapHeight / state.gridSize);
    const start = cellCoordinates(x, y);
    const startColumn = Math.floor(start.x / state.gridSize);
    const startRow = Math.floor(start.y / state.gridSize);
    if (
        startColumn < 0 ||
        startRow < 0 ||
        startColumn >= columns ||
        startRow >= rows
    ) return;

    const lookup = new Map();

    state.tiles.forEach(tile => {
        if (tile.layerId !== layer.id) return;
        const column = Math.floor(tile.x / state.gridSize);
        const row = Math.floor(tile.y / state.gridSize);
        lookup.set(row * columns + column, tile);
    });

    const startIndex = startRow * columns + startColumn;
    const startTile = lookup.get(startIndex) || null;
    if (regionMatches(startTile, paintTile.assetId, paintTile)) return;

    const matchesTarget = tile => startTile
        ? Boolean(tile && regionMatches(
            tile,
            startTile.assetId,
            tileRegion(startTile)
        ))
        : !tile;
    const queue = [startIndex];
    const visited = new Set([startIndex]);
    const fillIndices = [];
    const maximumFill = 250000;

    for (let cursor = 0; cursor < queue.length; cursor++) {
        const index = queue[cursor];
        const tile = lookup.get(index) || null;
        if (!matchesTarget(tile)) continue;
        fillIndices.push(index);

        if (fillIndices.length > maximumFill) {
            document.querySelector("#layerStatus").textContent =
                "Zone trop grande à remplir en une fois (limite : 250 000 cases).";
            return;
        }

        const column = index % columns;
        const row = Math.floor(index / columns);
        const neighbors = [
            column > 0 ? index - 1 : -1,
            column < columns - 1 ? index + 1 : -1,
            row > 0 ? index - columns : -1,
            row < rows - 1 ? index + columns : -1
        ];

        neighbors.forEach(neighbor => {
            if (neighbor >= 0 && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        });
    }

    fillIndices.forEach(index => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const existing = lookup.get(index);
        if (existing) {
            Object.assign(existing, paintTile);
        } else {
            state.tiles.push({
                ...paintTile,
                layerId: layer.id,
                x: column * state.gridSize,
                y: row * state.gridSize
            });
        }
    });
    render();
    refreshUI();
    saveHistory();
}

function pickTileAt(x, y) {
    const layer = state.layers.find(item => item.id === state.activeLayerId);
    if (!layer || layer.type !== "tiles") return;
    const { x: tx, y: ty } = cellCoordinates(x, y);
    const tile = state.tiles.find(item =>
        item.layerId === layer.id && item.x === tx && item.y === ty
    );
    if (!tile) {
        document.querySelector("#layerStatus").textContent =
            "Aucune tuile à prélever ici.";
        return;
    }

    if (!selectSheetTile(tile.assetId, tileRegion(tile))) return;
    state.selectedTileAssetId = tile.assetId;
    state.tool = "paint";
    document.querySelectorAll(".tool").forEach(button => {
        button.classList.toggle("active", button.dataset.tool === "paint");
    });
    document.querySelector("#tileAssetStatus").textContent =
        `Tuile active : ${state.assets.find(asset => asset.id === tile.assetId)?.name || "inconnue"}`;
    document.querySelector("#layerStatus").textContent =
        "Tuile prélevée. Le pinceau est actif.";
    refreshUI();
    render();
}

export function initObjectInteractions() {
    canvas.addEventListener("contextmenu", event => {
        event.preventDefault();
    });

    canvas.addEventListener("mousedown", event => {
        if (document.querySelector(".workspace")
            .classList.contains("visualization-mode")) {
            event.preventDefault();
            return;
        }

        if (event.button === 2 || event.button === 1) {
            state.isPanning = true;
            state.panStart = {
                x: event.clientX,
                y: event.clientY,
                scrollLeft: document.querySelector("#viewport").scrollLeft,
                scrollTop: document.querySelector("#viewport").scrollTop
            };
            return;
        }

        if (event.button !== 0) return;

        const activeLayer = state.layers.find(
            layer => layer.id === state.activeLayerId
        );
        if (!activeLayer) return;
        if (
            activeLayer.locked &&
            ["paint", "erase", "fill", "collision", "collisionErase", "entity"].includes(state.tool)
        ) return;

        const point = screenToMap(event.clientX, event.clientY);

        if (state.tool === "eyedropper") {
            pickTileAt(point.x, point.y);
            return;
        }

        if (state.tool === "fill") {
            fillContiguousAt(point.x, point.y);
            return;
        }

        if (state.tool === "paint") {
            if (!selectedPaintTile()) {
                alert("Choisis une tuile ou une découpe dans la palette.");
                return;
            }

            state.isPainting = true;
            state.paintVisitedCells = new Set();
            state.lastPaintCell = null;
            paintStrokeTo(point);
            return;
        }

        if (state.tool === "erase") {
            state.isPainting = true;
            state.paintVisitedCells = new Set();
            state.lastPaintCell = null;
            paintStrokeTo(point, true);
            return;
        }

        if (state.tool === "collision" || state.tool === "collisionErase") {
            if (activeLayer.type !== "collisions") return;
            if (
                state.tool === "collision" &&
                !state.collisionTypes.some(
                    type => type.id === state.selectedCollisionTypeId
                )
            ) {
                alert("Crée et sélectionne une grille de gameplay avant de peindre.");
                return;
            }

            state.isPainting = true;
            state.paintVisitedCells = new Set();
            state.lastPaintCell = null;
            paintStrokeTo(point, state.tool === "collisionErase", true);
            return;
        }

        if (state.tool === "place") {
            if (activeLayer.type !== "entities") return;
            const asset =
                state.assets.find(
                    item => item.id === state.selectedTileAssetId
                ) || state.assets.at(-1);

            if (asset) placeAsset(asset, point.x, point.y);
            return;
        }

        if (state.tool === "entity") {
            placeEntity(point.x, point.y);
            return;
        }

        if (activeLayer.type !== "entities") return;
        const object = hitObject(point.x, point.y);

        if (state.tool === "delete") {
            if (object) {
                state.objects = state.objects.filter(
                    item => item.id !== object.id
                );

                if (state.selectedId === object.id) {
                    state.selectedId = null;
                }

                saveHistory();
                refreshUI();
                render();
            }

            return;
        }

        if (!object) {
            selectObject(null);
            render();
            return;
        }

        const wasSelected = state.selectedId === object.id;
        selectObject(object.id);

        state.isDragging = true;
        state.dragMode = wasSelected
            ? (object.kind === "entity"
                ? "move"
                : hitHandle(object, point.x, point.y) || "move")
            : "move";

        state.dragStart = point;
        state.objectStart = {
            x: object.x,
            y: object.y,
            w: object.w,
            h: object.h
        };
    });

    window.addEventListener("mousemove", event => {
        const point = screenToMap(event.clientX, event.clientY);

        document.querySelector("#coords").textContent =
            `X: ${Math.round(point.x)} · Y: ${Math.round(point.y)}`;

        if (state.isPanning && state.panStart) {
            const viewport = document.querySelector("#viewport");

            viewport.scrollLeft =
                state.panStart.scrollLeft -
                (event.clientX - state.panStart.x);

            viewport.scrollTop =
                state.panStart.scrollTop -
                (event.clientY - state.panStart.y);

            return;
        }

        if (state.isPainting) {
            const collision = ["collision", "collisionErase"]
                .includes(state.tool);
            const erase = ["erase", "collisionErase"].includes(state.tool);
            paintStrokeTo(point, erase, collision);
            return;
        }

        if (!state.isDragging) {
            if (state.tool === "select") {
                const hoveredObject = hitObject(point.x, point.y);
                const handleId = hoveredObject?.kind !== "entity" &&
                    hoveredObject?.id === state.selectedId
                    ? hitHandle(hoveredObject, point.x, point.y)
                    : null;
                canvas.style.cursor = handleId
                    ? resizeHandles.find(handle => handle.id === handleId).cursor
                    : hoveredObject ? "move" : "default";
            }
            return;
        }

        const object = state.objects.find(
            item => item.id === state.selectedId
        );

        if (!object) return;

        const dx = point.x - state.dragStart.x;
        const dy = point.y - state.dragStart.y;

        if (state.dragMode === "move") {
            object.x = state.objectStart.x + dx;
            object.y = state.objectStart.y + dy;

            if (state.snap) {
                object.x = snap(object.x);
                object.y = snap(object.y);
            }
        } else if (object.kind !== "entity") {
            resizeObject(object, dx, dy, state.dragMode, event.shiftKey);
        }

        render();
        refreshUI(false);
    });

    window.addEventListener("mouseup", () => {
        if (state.isDragging) {
            state.isDragging = false;
            saveHistory();
            refreshUI();
        }

        if (state.isPainting) {
            state.isPainting = false;
            state.lastPaintCell = null;
            state.paintVisitedCells = null;
            saveHistory();
            refreshUI();
        }

        state.isPanning = false;
        state.panStart = null;
    });

    canvas.addEventListener("dragover", event => {
        if (document.querySelector(".workspace")
            .classList.contains("visualization-mode")) {
            event.preventDefault();
            return;
        }

        event.preventDefault();
        document.querySelector("#dropHint").classList.add("dragging");
    });

    canvas.addEventListener("dragleave", () => {
        document.querySelector("#dropHint").classList.remove("dragging");
    });

    canvas.addEventListener("drop", async event => {
        event.preventDefault();
        if (document.querySelector(".workspace")
            .classList.contains("visualization-mode")) return;

        document.querySelector("#dropHint").classList.remove("dragging");

        const activeLayer = state.layers.find(
            layer => layer.id === state.activeLayerId
        );
        if (!activeLayer || activeLayer.locked) return;
        if (activeLayer.type !== "entities") {
            document.querySelector("#layerStatus").textContent =
                "Sélectionne un calque d’entités pour déposer des images.";
            return;
        }

        const files = [...event.dataTransfer.files].filter(
            file => file.type.startsWith("image/")
        );

        if (!files.length) return;

        const point = screenToMap(event.clientX, event.clientY);

        try {
            const assets = await Promise.all(files.map(addAsset));

            assets.forEach((asset, index) => {
                placeAsset(asset, point.x + index * 24, point.y + index * 24);
            });

            refreshUI();
        } catch (error) {
            alert(error.message);
        }
    });
}

export function deleteSelected() {
    if (!state.selectedId) return;

    const selected = state.objects.find(
        object => object.id === state.selectedId
    );
    const layer = state.layers.find(
        item => item.id === selected?.layerId
    );
    if (layer?.locked) return;

    state.objects = state.objects.filter(
        object => object.id !== state.selectedId
    );

    state.selectedId = null;
    saveHistory();
    refreshUI();
    render();
}

export function duplicateSelected() {
    const object = state.objects.find(
        item => item.id === state.selectedId
    );

    if (!object) return;
    const layer = state.layers.find(item => item.id === object.layerId);
    if (!layer || layer.locked) return;

    const copy = {
        ...object,
        id: uid(),
        x: object.x + state.gridSize,
        y: object.y + state.gridSize,
        name: `${object.name} copie`,
        fields: object.fields ? { ...object.fields } : undefined
    };

    state.objects.push(copy);
    selectObject(copy.id);
    saveHistory();
    refreshUI();
    render();
}
