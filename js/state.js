
export function normalizeEntityBehavior(behavior) {
    const source = behavior && typeof behavior === "object" ? behavior : {};
    const directions = ["right", "left", "up", "down"];
    const distance = Number(source.distance);
    const speed = Number(source.speed);

    return {
        type: source.type === "patrol" ? "patrol" : "static",
        direction: directions.includes(source.direction)
            ? source.direction
            : "right",
        distance: Number.isFinite(distance) && distance > 0
            ? distance
            : 128,
        speed: Number.isFinite(speed) && speed > 0 ? speed : 60
    };
}

export function normalizeMovementBehavior(behavior) {
    const source = behavior && typeof behavior === "object" ? behavior : {};
    const deltaX = Number(source.deltaX);
    const deltaY = Number(source.deltaY);
    const speed = Number(source.speed);

    let normalizedDeltaX = Number.isFinite(deltaX) ? deltaX : 128;
    let normalizedDeltaY = Number.isFinite(deltaY) ? deltaY : 0;
    if (normalizedDeltaX === 0 && normalizedDeltaY === 0) {
        normalizedDeltaX = 128;
    }

    return {
        id: typeof source.id === "string" ? source.id : "",
        name: typeof source.name === "string" ? source.name : "Patrouille",
        type: "patrol",
        deltaX: normalizedDeltaX,
        deltaY: normalizedDeltaY,
        speed: Number.isFinite(speed) && speed > 0 ? speed : 60
    };
}

export function legacyBehaviorToMovement(type, behavior) {
    const normalized = normalizeEntityBehavior(behavior);
    const offsets = {
        right: [1, 0],
        left: [-1, 0],
        up: [0, -1],
        down: [0, 1]
    };
    const [x, y] = offsets[normalized.direction];
    return normalizeMovementBehavior({
        id: `behavior_legacy_${type.id}`,
        name: `${type.name} · Patrouille`,
        deltaX: x * normalized.distance,
        deltaY: y * normalized.distance,
        speed: normalized.speed
    });
}

export function entityImageSize(type, assets, gridSize, appearance = type) {
    const asset = assets.find(
        item => item.id === appearance?.imageAssetId
    );
    if (!asset) {
        const size = Math.max(16, Math.min(32, gridSize * 0.6));
        return { width: size, height: size };
    }

    const region = appearance.imageRegion;
    const width = region?.width || asset.width;
    const height = region?.height || asset.height;
    const scale = Math.max(16, Math.min(64, gridSize * 2)) /
        Math.max(width, height);
    return {
        width: width * scale,
        height: height * scale
    };
}

export const defaultEntityTypes = [{
    id: "entity_spawn",
    name: "Point d’apparition",
    color: "#55d69e",
    imageAssetId: null,
    imageRegion: null,
    behavior: normalizeEntityBehavior(),
    fields: [{
        id: "direction",
        name: "Direction",
        type: "direction",
        defaultValue: "right"
    }]
}];

export const state = {
    mapWidth: 1600,
    mapHeight: 900,
    gridSize: 32,
    bgColor: "#101827",

    zoom: 1,
    tool: "select",
    snap: false,

    assets: [],
    animations: [],
    selectedAnimationId: null,
    animationClock: 0,
    objects: [],
    tiles: [],
    collisionCells: [],
    collisionTypes: [],
    selectedCollisionTypeId: null,
    showCollisionGrid: false,
    layers: [
        { id: "tiles_1", name: "Tuiles", type: "tiles", visible: true, locked: false },
        { id: "entities_1", name: "Entités", type: "entities", visible: true, locked: false },
        { id: "collisions_1", name: "Collisions", type: "collisions", visible: true, locked: false }
    ],
    activeLayerId: "tiles_1",
    entityTypes: defaultEntityTypes.map(type => ({
        ...type,
        behavior: { ...type.behavior },
        fields: type.fields.map(field => ({ ...field }))
    })),
    selectedEntityTypeId: "entity_spawn",
    behaviors: [],
    selectedBehaviorId: null,
    levels: [],
    currentLevelId: "level_1",

    selectedTileAssetId: null,
    selectedTileRegion: null,
    selectedId: null,
    nextId: 1,

    isPainting: false,
    lastPaintCell: null,
    paintVisitedCells: null,
    brushSize: 1,

    isDragging: false,
    dragMode: null,
    dragStart: null,
    objectStart: null,

    isPanning: false,
    panStart: null,

    history: [],
    historyIndex: -1
};

function copyLevelData(data) {
    return JSON.parse(JSON.stringify(data));
}

export function snapshotCurrentLevel() {
    return {
        mapWidth: state.mapWidth,
        mapHeight: state.mapHeight,
        gridSize: state.gridSize,
        bgColor: state.bgColor,
        objects: state.objects.map(object => ({ ...object })),
        tiles: state.tiles.map(tile => ({ ...tile })),
        collisionCells: state.collisionCells.map(cell => ({ ...cell })),
        collisionTypes: state.collisionTypes.map(type => ({ ...type })),
        selectedCollisionTypeId: state.selectedCollisionTypeId,
        layers: state.layers.map(layer => ({ ...layer })),
        activeLayerId: state.activeLayerId,
        selectedId: state.selectedId,
        selectedTileAssetId: state.selectedTileAssetId,
        selectedTileRegion: state.selectedTileRegion
            ? { ...state.selectedTileRegion }
            : null,
        nextId: state.nextId
    };
}

export function normalizeLevelData(data) {
    const sourceObjects = Array.isArray(data.objects) ? data.objects : [];
    const sourceTiles = Array.isArray(data.tiles) ? data.tiles : [];
    const sourceCells = Array.isArray(data.collisionCells)
        ? data.collisionCells
        : [];
    const rawLayers = Array.isArray(data.layers) && data.layers.length
        ? data.layers
        : [{
            id: "tiles_1",
            name: "Tuiles",
            type: "tiles",
            visible: true,
            locked: false
        }, {
            id: "entities_1",
            name: "Entités",
            type: "entities",
            visible: true,
            locked: false
        }];
    const layers = [];
    const layerMap = new Map();

    rawLayers.forEach((source, index) => {
        const id = source.id || `layer_${index + 1}`;
        const base = {
            ...source,
            id,
            name: source.name || `Calque ${index + 1}`,
            visible: source.visible !== false,
            locked: Boolean(source.locked)
        };
        if (["tiles", "entities", "collisions"].includes(source.type)) {
            layers.push(base);
            layerMap.set(id, { [source.type]: id });
            return;
        }

        const hasTiles = sourceTiles.some(tile => tile.layerId === id);
        const hasObjects = sourceObjects.some(object => object.layerId === id);
        const types = {};
        if (hasTiles || !hasObjects) {
            const tileLayer = {
                ...base,
                type: "tiles",
                name: hasObjects ? `${base.name} · Tuiles` : base.name
            };
            layers.push(tileLayer);
            types.tiles = tileLayer.id;
        }
        if (hasObjects) {
            const entityId = hasTiles ? `${id}_entities` : id;
            const entityLayer = {
                ...base,
                id: entityId,
                type: "entities",
                name: hasTiles ? `${base.name} · Entités` : base.name
            };
            layers.push(entityLayer);
            types.entities = entityId;
        }
        layerMap.set(id, types);
    });

    if (!layers.some(layer => layer.type === "tiles")) {
        layers.push({
            id: "tiles_1",
            name: "Tuiles",
            type: "tiles",
            visible: true,
            locked: false
        });
    }
    if (!layers.some(layer => layer.type === "entities")) {
        layers.push({
            id: "entities_1",
            name: "Entités",
            type: "entities",
            visible: true,
            locked: false
        });
    }
    if (sourceCells.length && !layers.some(layer => layer.type === "collisions")) {
        layers.push({
            id: "collisions_1",
            name: "Collisions",
            type: "collisions",
            visible: true,
            locked: false
        });
    }

    const firstLayer = type => layers.find(layer => layer.type === type);
    const remap = (id, type) => {
        const mapped = layerMap.get(id)?.[type];
        return layers.find(layer => layer.id === id && layer.type === type)?.id ||
            mapped ||
            firstLayer(type).id;
    };
    const collisionLayer = firstLayer("collisions");
    const normalizedLayers = layers.map(layer => ({
        ...layer,
        visible: layer.visible !== false,
        locked: Boolean(layer.locked)
    }));
    const activeLayerId = normalizedLayers.some(layer => layer.id === data.activeLayerId)
        ? data.activeLayerId
        : firstLayer("tiles").id;

    return {
        mapWidth: data.mapWidth || 1600,
        mapHeight: data.mapHeight || 900,
        gridSize: data.gridSize || 32,
        bgColor: data.bgColor || "#101827",
        objects: sourceObjects.map(object => ({
            ...object,
            kind: object.kind === "entity" ? "entity" : "image",
            layerId: remap(object.layerId, "entities")
        })),
        tiles: sourceTiles.map(tile => ({
            ...tile,
            layerId: remap(tile.layerId, "tiles")
        })),
        collisionCells: sourceCells.map(cell => ({
            ...cell,
            layerId: layers.some(layer =>
                layer.id === cell.layerId && layer.type === "collisions"
            ) ? cell.layerId : collisionLayer?.id
        })),
        collisionTypes: Array.isArray(data.collisionTypes)
            ? data.collisionTypes.map(type => ({ ...type }))
            : [],
        selectedCollisionTypeId: data.selectedCollisionTypeId || null,
        layers: normalizedLayers,
        activeLayerId,
        selectedId: data.selectedId || null,
        selectedTileAssetId: data.selectedTileAssetId || null,
        selectedTileRegion: data.selectedTileRegion
            ? { ...data.selectedTileRegion }
            : null,
        nextId: data.nextId || 1
    };
}

export function syncCurrentLevel() {
    if (!state.currentLevelId) return;

    const level = state.levels.find(item => item.id === state.currentLevelId);
    if (level) level.data = snapshotCurrentLevel();
}

export function loadLevelData(data) {
    Object.assign(state, normalizeLevelData(data));
}

state.levels = [{
    id: state.currentLevelId,
    name: "Niveau 1",
    data: snapshotCurrentLevel()
}];

export function uid() {
    return `obj_${state.nextId++}`;
}

export function animationFrameAt(animation, elapsed = 0) {
    if (!animation?.frames?.length) return null;
    const totalDuration = animation.frames.reduce(
        (total, frame) => total + frame.duration,
        0
    );
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
        return animation.frames[0];
    }

    let frameTime = ((elapsed % totalDuration) + totalDuration) % totalDuration;
    for (const frame of animation.frames) {
        if (frameTime < frame.duration) return frame;
        frameTime -= frame.duration;
    }
    return animation.frames[0];
}

function assetToSerializable(asset) {
    return {
        id: asset.id,
        name: asset.name,
        dataUrl: asset.dataUrl,
        width: asset.width,
        height: asset.height
    };
}

export function cloneData() {
    syncCurrentLevel();
    return JSON.parse(JSON.stringify({
        mapWidth: state.mapWidth,
        mapHeight: state.mapHeight,
        gridSize: state.gridSize,
        bgColor: state.bgColor,
        assets: state.assets.map(assetToSerializable),
        animations: state.animations.map(animation => ({
            ...animation,
            frames: animation.frames.map(frame => ({ ...frame }))
        })),
        selectedAnimationId: state.selectedAnimationId,
        entityTypes: state.entityTypes.map(type => ({
            ...type,
            behavior: { ...normalizeEntityBehavior(type.behavior) },
            fields: type.fields.map(field => ({ ...field }))
        })),
        selectedEntityTypeId: state.selectedEntityTypeId,
        behaviors: state.behaviors.map(behavior => ({
            ...normalizeMovementBehavior(behavior)
        })),
        selectedBehaviorId: state.selectedBehaviorId,
        objects: state.objects.map(o => ({ ...o })),
        tiles: state.tiles.map(t => ({ ...t })),
        collisionCells: state.collisionCells.map(cell => ({ ...cell })),
        collisionTypes: state.collisionTypes.map(type => ({ ...type })),
        selectedCollisionTypeId: state.selectedCollisionTypeId,
        layers: state.layers.map(layer => ({ ...layer })),
        activeLayerId: state.activeLayerId,
        levels: state.levels.map(level => ({
            ...level,
            data: copyLevelData(level.data)
        })),
        currentLevelId: state.currentLevelId,
        selectedId: state.selectedId,
        selectedTileAssetId: state.selectedTileAssetId,
        selectedTileRegion: state.selectedTileRegion
            ? { ...state.selectedTileRegion }
            : null,
        nextId: state.nextId
    }));
}

export function restoreData(data) {
    const assets = Array.isArray(data.assets)
        ? data.assets.map(asset => {
            const restoredAsset = {
                ...asset,
                img: null
            };

            if (restoredAsset.dataUrl) {
                const img = new Image();
                img.onload = () => {
                    if (typeof document !== "undefined") {
                        document.dispatchEvent(
                            new Event("history-asset-loaded")
                        );
                    }
                };
                img.onerror = () => {
                    if (typeof document !== "undefined") {
                        document.dispatchEvent(new CustomEvent(
                            "history-asset-error",
                            { detail: restoredAsset.name }
                        ));
                    }
                };
                img.src = restoredAsset.dataUrl;
                restoredAsset.img = img;
            }

            return restoredAsset;
        })
        : [];

    state.assets = assets;
    state.animations = Array.isArray(data.animations)
        ? data.animations.map(animation => ({
            ...animation,
            frames: Array.isArray(animation.frames)
                ? animation.frames.map(frame => ({ ...frame }))
                : []
        }))
        : [];
    state.selectedAnimationId = data.selectedAnimationId || null;
    state.entityTypes = Array.isArray(data.entityTypes)
        ? data.entityTypes.map(type => ({
            ...type,
            behavior: normalizeEntityBehavior(type.behavior),
            fields: Array.isArray(type.fields)
                ? type.fields.map(field => ({ ...field }))
                : []
        }))
        : defaultEntityTypes.map(type => ({
            ...type,
            behavior: { ...type.behavior },
            fields: type.fields.map(field => ({ ...field }))
        }));
    state.selectedEntityTypeId = data.selectedEntityTypeId ||
        state.entityTypes[0]?.id || null;
    state.behaviors = Array.isArray(data.behaviors)
        ? data.behaviors.map(behavior =>
            normalizeMovementBehavior(behavior)
        )
        : [];
    state.selectedBehaviorId = state.behaviors.some(
        behavior => behavior.id === data.selectedBehaviorId
    ) ? data.selectedBehaviorId : state.behaviors[0]?.id || null;
    state.levels = Array.isArray(data.levels)
        ? data.levels.map(level => ({
            ...level,
            data: copyLevelData(level.data)
        }))
        : [];
    state.currentLevelId = data.currentLevelId || state.levels[0]?.id || "level_1";
    loadLevelData(data);
    if (!state.levels.length) {
        state.levels = [{
            id: state.currentLevelId,
            name: "Niveau 1",
            data: snapshotCurrentLevel()
        }];
    }
}
