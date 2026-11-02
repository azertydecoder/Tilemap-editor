import {
    state,
    defaultEntityTypes,
    loadLevelData,
    normalizeEntityBehavior,
    normalizeMovementBehavior,
    legacyBehaviorToMovement,
    normalizeLevelData,
    syncCurrentLevel
} from "./state.js";
import { render, resizeCanvas } from "./renderer.js";
import { refreshUI, saveHistory, selectObject } from "./main.js";

function levelToProjectData(level) {
    const data = level.data;

    return {
        id: level.id,
        name: level.name,
        map: {
            width: data.mapWidth,
            height: data.mapHeight,
            gridSize: data.gridSize,
            bgColor: data.bgColor
        },
        layers: data.layers.map(layer => ({ ...layer })),
        activeLayerId: data.activeLayerId,
        collisionTypes: data.collisionTypes.map(type => ({ ...type })),
        selectedCollisionTypeId: data.selectedCollisionTypeId,
        selectedTileAssetId: data.selectedTileAssetId,
        selectedTileRegion: data.selectedTileRegion
            ? { ...data.selectedTileRegion }
            : null,
        tiles: data.tiles.map(tile => ({ ...tile })),
        collisionCells: data.collisionCells.map(cell => ({ ...cell })),
        objects: data.objects.map(object => ({ ...object }))
    };
}

export function exportProject() {
    syncCurrentLevel();
    const data = {
        format: "faille-map",
        version: 3,
        metadata: {
            title: "Mon_Niveau",
            createdAt: new Date().toISOString()
        },
        assets: state.assets.map(asset => ({
            id: asset.id,
            name: asset.name,
            dataUrl: asset.dataUrl,
            width: asset.width,
            height: asset.height
        })),
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
        behaviors: state.behaviors.map(behavior => ({
            ...normalizeMovementBehavior(behavior)
        })),
        selectedBehaviorId: state.selectedBehaviorId,
        selectedEntityTypeId: state.selectedEntityTypeId,
        currentLevelId: state.currentLevelId,
        levels: state.levels.map(levelToProjectData)
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tilemap-studio.json";
    anchor.click();
    URL.revokeObjectURL(url);
}

function normalizeLevel(level, index, assets) {
    const map = level.map || {};
    const rawCollisionCells = Array.isArray(level.collisionCells)
        ? level.collisionCells
        : [];
    const legacyNames = {
        solid: "Solide",
        platform: "Plateforme traversable",
        hazard: "Danger",
        water: "Eau"
    };
    let collisionTypes = Array.isArray(level.collisionTypes)
        ? level.collisionTypes
            .filter(type =>
                type &&
                typeof type.id === "string" &&
                typeof type.name === "string" &&
                /^#[0-9a-f]{6}$/i.test(type.color)
            )
            .map(type => ({
                ...type,
                opacity: Number.isFinite(Number(type.opacity))
                    ? Math.max(0, Math.min(100, Number(type.opacity)))
                    : 48
            }))
        : [];

    if (!collisionTypes.length) {
        const legacyTypeIds = [
            ...new Set(rawCollisionCells
                .map(cell => cell.typeId || cell.type)
                .filter(typeId => typeof typeId === "string"))
        ];
        collisionTypes = legacyTypeIds.map(typeId => ({
            id: typeId,
            name: legacyNames[typeId] || typeId,
            color: {
                solid: "#f44e5c",
                platform: "#4ba6ff",
                hazard: "#ff9933",
                water: "#36c2cd"
            }[typeId] || "#f44e5c",
            opacity: 48
        }));
    }

    const validCollisionTypeIds = new Set(
        collisionTypes.map(type => type.id)
    );
    const layers = Array.isArray(level.layers) && level.layers.length
        ? level.layers.map((layer, layerIndex) => ({
            ...layer,
            id: layer.id || `layer_${index + 1}_${layerIndex + 1}`,
            name: layer.name || `Calque ${layerIndex + 1}`,
            visible: layer.visible !== false,
            locked: Boolean(layer.locked)
        }))
        : [{
            id: `layer_${index + 1}`,
            name: "Calque 1",
            visible: true,
            locked: false
        }];
    const objects = Array.isArray(level.objects) ? level.objects : [];

    return {
        id: typeof level.id === "string" ? level.id : `level_${index + 1}`,
        name: typeof level.name === "string" && level.name.trim()
            ? level.name.trim()
            : `Niveau ${index + 1}`,
        data: {
            mapWidth: map.width || level.mapWidth || 1600,
            mapHeight: map.height || level.mapHeight || 900,
            gridSize: map.gridSize || level.gridSize || 32,
            bgColor: map.bgColor || level.bgColor || "#101827",
            layers,
            activeLayerId: level.activeLayerId,
            objects: objects.map(object => ({
                ...object,
                layerId: object.layerId || layers[0].id
            })),
            tiles: (Array.isArray(level.tiles) ? level.tiles : [])
                .map(tile => ({
                    ...tile,
                    layerId: tile.layerId || layers[0].id
                })),
            collisionCells: rawCollisionCells
                .map(cell => ({
                    ...cell,
                    typeId: cell.typeId || cell.type
                }))
                .filter(cell => validCollisionTypeIds.has(cell.typeId)),
            collisionTypes,
            selectedCollisionTypeId: level.selectedCollisionTypeId,
            selectedId: null,
            selectedTileAssetId: level.selectedTileAssetId ||
                level.tiles?.[0]?.assetId ||
                assets[0]?.id ||
                null,
            selectedTileRegion: level.selectedTileRegion &&
                assets.some(asset => asset.id === level.selectedTileRegion.assetId)
                ? { ...level.selectedTileRegion }
                : null,
            nextId: Math.max(
                1,
                ...objects.map(object =>
                    Number(object.id?.split("_").at(-1)) || 0
                )
            ) + 1
        }
    };
}

export async function importProject(file) {
    const project = JSON.parse(await file.text());
    if (!Array.isArray(project.assets)) {
        throw new Error("Format de projet non reconnu.");
    }
    if (Array.isArray(project.levels) && !project.levels.length) {
        throw new Error("Le projet doit contenir au moins un niveau.");
    }
    if (
        !Array.isArray(project.levels) &&
        (!project.map || !Array.isArray(project.objects))
    ) {
        throw new Error("Format de projet non reconnu.");
    }

    const assets = await Promise.all(project.assets.map(item =>
        new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({ ...item, img: image });
            image.onerror = () => reject(
                new Error(`Image invalide : ${item.name}`)
            );
            image.src = item.dataUrl;
        })
    ));
    const animations = Array.isArray(project.animations)
        ? project.animations.map((animation, index) => {
            if (
                !animation ||
                typeof animation.id !== "string" ||
                typeof animation.name !== "string" ||
                !Array.isArray(animation.frames) ||
                !animation.frames.length
            ) {
                throw new Error(`Animation invalide à l’index ${index}.`);
            }
            const frames = animation.frames.map((frame, frameIndex) => {
                const asset = assets.find(item => item.id === frame?.assetId);
                const duration = Number(frame?.duration);
                if (!asset || !Number.isFinite(duration) || duration <= 0) {
                    throw new Error(
                        `Frame ${frameIndex + 1} invalide dans « ${animation.name} ».`
                    );
                }
                return { assetId: asset.id, duration };
            });
            return { id: animation.id, name: animation.name, frames };
        })
        : [];
    const animationIds = new Set(animations.map(animation => animation.id));
    const entityTypes = Array.isArray(project.entityTypes)
        ? project.entityTypes
            .filter(type =>
                type &&
                typeof type.id === "string" &&
                typeof type.name === "string"
            )
            .map(type => ({
                ...type,
                color: /^#[0-9a-f]{6}$/i.test(type.color)
                    ? type.color
                    : "#55d69e",
                imageAssetId: assets.some(asset =>
                    asset.id === type.imageAssetId
                ) ? type.imageAssetId : null,
                imageRegion: type.imageRegion &&
                    Number.isFinite(type.imageRegion.x) &&
                    Number.isFinite(type.imageRegion.y) &&
                    Number.isFinite(type.imageRegion.width) &&
                    Number.isFinite(type.imageRegion.height) &&
                    type.imageRegion.x >= 0 &&
                    type.imageRegion.y >= 0 &&
                    type.imageRegion.width > 0 &&
                    type.imageRegion.height > 0 &&
                    assets.some(asset =>
                        asset.id === type.imageAssetId &&
                        type.imageRegion.x + type.imageRegion.width <= asset.width &&
                        type.imageRegion.y + type.imageRegion.height <= asset.height
                    )
                    ? { ...type.imageRegion }
                    : null,
                behavior: normalizeEntityBehavior(type.behavior),
                fields: (Array.isArray(type.fields) ? type.fields : [])
                    .filter(field =>
                        field &&
                        typeof field.id === "string" &&
                        typeof field.name === "string" &&
                        ["text", "number", "boolean", "direction"].includes(field.type)
                    )
                    .map(field => ({ ...field }))
            }))
        : defaultEntityTypes.map(type => ({
            ...type,
            behavior: { ...type.behavior },
            fields: type.fields.map(field => ({ ...field }))
        }));
    const behaviors = Array.isArray(project.behaviors)
        ? project.behaviors
            .filter(behavior =>
                behavior &&
                typeof behavior.id === "string" &&
                typeof behavior.name === "string"
            )
            .map(behavior => normalizeMovementBehavior(behavior))
        : [];
    const legacyBehaviorIds = new Map();
    entityTypes.forEach(type => {
        const legacyBehavior = normalizeEntityBehavior(type.behavior);
        if (legacyBehavior.type !== "patrol") return;
        const behavior = legacyBehaviorToMovement(type, legacyBehavior);
        legacyBehaviorIds.set(type.id, behavior.id);
        if (!behaviors.some(item => item.id === behavior.id)) {
            behaviors.push(behavior);
        }
    });
    const sourceLevels = Array.isArray(project.levels) && project.levels.length
        ? project.levels
        : [{
            id: "level_1",
            name: "Niveau 1",
            map: project.map,
            layers: project.layers,
            activeLayerId: project.activeLayerId,
            collisionTypes: project.collisionTypes,
            selectedCollisionTypeId: project.selectedCollisionTypeId,
            selectedTileAssetId: project.selectedTileAssetId,
            selectedTileRegion: project.selectedTileRegion,
            tiles: project.tiles,
            collisionCells: project.collisionCells,
            objects: project.objects
        }];

    state.assets = assets;
    state.animations = animations;
    state.selectedAnimationId = animations.some(
        animation => animation.id === project.selectedAnimationId
    ) ? project.selectedAnimationId : animations[0]?.id || null;
    state.behaviors = behaviors;
    state.selectedBehaviorId = behaviors.some(
        behavior => behavior.id === project.selectedBehaviorId
    ) ? project.selectedBehaviorId : behaviors[0]?.id || null;
    state.entityTypes = entityTypes;
    state.selectedEntityTypeId = entityTypes.some(
        type => type.id === project.selectedEntityTypeId
    ) ? project.selectedEntityTypeId : entityTypes[0]?.id || null;
    const behaviorIds = new Set(behaviors.map(behavior => behavior.id));
    state.levels = sourceLevels.map((level, index) => {
        const normalizedSource = {
            ...level,
            objects: (Array.isArray(level.objects) ? level.objects : [])
                .map(object => {
                    const behaviorId = Object.hasOwn(object, "behaviorId")
                        ? object.behaviorId
                        : legacyBehaviorIds.get(object.entityTypeId) || null;
                    const imageAsset = assets.find(asset =>
                        asset.id === object.imageAssetId
                    );
                    const imageRegion = object.imageRegion;
                    const validImageRegion = imageAsset &&
                        imageRegion &&
                        Number.isFinite(imageRegion.x) &&
                        Number.isFinite(imageRegion.y) &&
                        Number.isFinite(imageRegion.width) &&
                        Number.isFinite(imageRegion.height) &&
                        imageRegion.x >= 0 &&
                        imageRegion.y >= 0 &&
                        imageRegion.width > 0 &&
                        imageRegion.height > 0 &&
                        imageRegion.x + imageRegion.width <= imageAsset.width &&
                        imageRegion.y + imageRegion.height <= imageAsset.height;
                    const normalizedObject = {
                        ...object,
                        behaviorId: behaviorIds.has(behaviorId)
                            ? behaviorId
                            : null
                    };
                    if (object.animationId) {
                        normalizedObject.animationId =
                            animationIds.has(object.animationId)
                                ? object.animationId
                                : null;
                    }
                    if (object.kind !== "entity") return normalizedObject;
                    return {
                        ...normalizedObject,
                        imageOverride: object.imageOverride === true &&
                            (object.imageAssetId == null || imageAsset != null),
                        imageAssetId: imageAsset ? imageAsset.id : null,
                        imageRegion: validImageRegion
                            ? { ...imageRegion }
                            : null
                    };
                })
        };
        return normalizeLevel(normalizedSource, index, assets);
    });
    state.levels.forEach(level => {
        level.data = normalizeLevelData(level.data);
    });
    const selectedLevel = state.levels.find(
        level => level.id === project.currentLevelId
    ) || state.levels[0];
    state.currentLevelId = selectedLevel.id;
    loadLevelData(selectedLevel.data);
    state.tool = "select";
    document.querySelectorAll(".tool").forEach(button => {
        button.classList.toggle("active", button.dataset.tool === "select");
    });
    document.querySelector("#mapCanvas").style.cursor = "default";

    document.querySelector("#mapWidth").value = state.mapWidth;
    document.querySelector("#mapHeight").value = state.mapHeight;
    document.querySelector("#gridSize").value = state.gridSize;
    document.querySelector("#bgColor").value = state.bgColor;
    resizeCanvas();
    refreshUI();
    saveHistory(true);
    render();
    selectObject(null);
}
