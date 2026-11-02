import {
    state,
    cloneData,
    restoreData,
    loadLevelData,
    syncCurrentLevel,
    entityImageSize,
    animationFrameAt
} from "./state.js";
import { render, resizeCanvas } from "./renderer.js";
import {
    addAsset,
    placeAsset,
    placeAssetRegion,
    placeAnimation,
    placeEntity,
    initObjectInteractions,
    deleteSelected,
    duplicateSelected
} from "./objects.js";
import { exportProject, importProject } from "./io.js";
import {
    initSpritesheetPreview,
    updateSheetPreview
} from "./spritesheet.js";

const $ = selector => document.querySelector(selector);
let visualizationFrame = 0;
let visualizationPaused = false;
let visualizationLastFrame = 0;
let visualizationMotions = new Map();
let visualizationDisabledControls = null;
let animationPreviewPlaying = false;
let animationPreviewFrame = 0;
let animationPreviewLastFrame = 0;

document.addEventListener("history-asset-loaded", () => {
    refreshUI();
    render();
});

document.addEventListener("history-asset-error", event => {
    alert(`Impossible de restaurer l'image « ${event.detail} » depuis l'historique.`);
});

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

export function selectObject(id) {
    state.selectedId = id;
    refreshUI();
    render();
}

function activeLayer() {
    return state.layers.find(layer => layer.id === state.activeLayerId);
}

function getVisualizationPositions(elapsedSeconds = 0) {
    const positions = new Map();
    for (const object of state.objects) {
        if (object.kind !== "entity") continue;
        const behavior = state.behaviors.find(
            item => item.id === object.behaviorId && item.type === "patrol"
        );
        if (!behavior) continue;

        const deltaX = Number(behavior.deltaX);
        const deltaY = Number(behavior.deltaY);
        const speed = Number(behavior.speed);
        const distance = Math.hypot(deltaX, deltaY);
        if (
            !Number.isFinite(distance) || distance <= 0 ||
            !Number.isFinite(speed) || speed <= 0
        ) {
            continue;
        }

        const motion = visualizationMotions.get(object.id) || {
            progress: 0,
            direction: 1
        };
        const period = 2 * distance;
        let phase = motion.direction === 1
            ? motion.progress
            : period - motion.progress;
        phase = (phase + speed * elapsedSeconds) % period;
        if (phase < distance) {
            motion.progress = phase;
            motion.direction = 1;
        } else if (phase > distance) {
            motion.progress = period - phase;
            motion.direction = -1;
        } else {
            motion.progress = distance;
            motion.direction = -1;
        }
        visualizationMotions.set(object.id, motion);

        const ratio = motion.progress / distance;
        positions.set(object.id, {
            x: object.x + deltaX * ratio,
            y: object.y + deltaY * ratio
        });
    }
    return positions;
}

function drawAnimationPreview() {
    const canvas = $("#animationPreview");
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);

    const animation = state.animations.find(
        item => item.id === state.selectedAnimationId
    );
    const frame = animation
        ? animationFrameAt(animation, state.animationClock)
        : null;
    const asset = state.assets.find(item => item.id === frame?.assetId);
    if (asset?.img) {
        const scale = Math.min(
            canvas.width / asset.width,
            canvas.height / asset.height
        );
        const width = asset.width * scale;
        const height = asset.height * scale;
        context.imageSmoothingEnabled = false;
        context.drawImage(
            asset.img,
            (canvas.width - width) / 2,
            (canvas.height - height) / 2,
            width,
            height
        );
    }
}

function renderAnimationPreviewFrame(timestamp) {
    if (
        !animationPreviewPlaying ||
        $(".workspace").classList.contains("visualization-mode")
    ) {
        animationPreviewFrame = 0;
        animationPreviewLastFrame = 0;
        return;
    }

    const elapsed = animationPreviewLastFrame
        ? Math.min(timestamp - animationPreviewLastFrame, 100)
        : 0;
    animationPreviewLastFrame = timestamp;
    state.animationClock += elapsed;
    drawAnimationPreview();
    render({ animationTime: state.animationClock });
    animationPreviewFrame = requestAnimationFrame(renderAnimationPreviewFrame);
}

function setAnimationPreviewPlaying(playing) {
    animationPreviewPlaying = playing;
    animationPreviewLastFrame = 0;
    $("#animationPlayBtn").textContent = playing ? "⏸ Pause" : "▶ Lire";
    if (playing && !animationPreviewFrame) {
        animationPreviewFrame = requestAnimationFrame(renderAnimationPreviewFrame);
    } else if (!playing && animationPreviewFrame) {
        cancelAnimationFrame(animationPreviewFrame);
        animationPreviewFrame = 0;
    }
}

function renderVisualizationFrame(timestamp) {
    if (!$(".workspace").classList.contains("visualization-mode")) {
        visualizationFrame = 0;
        return;
    }
    const elapsedSeconds = visualizationLastFrame
        ? Math.min((timestamp - visualizationLastFrame) / 1000, 0.1)
        : 0;
    visualizationLastFrame = timestamp;

    const positions = getVisualizationPositions(
        visualizationPaused ? 0 : elapsedSeconds
    );
    if (!visualizationPaused) {
        state.animationClock += elapsedSeconds * 1000;
    }
    drawAnimationPreview();
    render({
        previewPositions: positions,
        visualizationMode: true,
        animationTime: state.animationClock
    });
    visualizationFrame = requestAnimationFrame(renderVisualizationFrame);
}

function updateVisualizationStatus() {
    const movingEntityCount = state.objects.filter(object =>
        object.kind === "entity" &&
        state.behaviors.some(behavior =>
            behavior.id === object.behaviorId && behavior.type === "patrol"
        )
    ).length;
    $(".visualization-label").textContent = movingEntityCount
        ? `Aperçu animé · ${movingEntityCount} entité(s) mobile(s) · sans blocage physique`
        : "Aucune entité mobile sur ce niveau · sans blocage physique";
}

function setVisualizationMode(enabled) {
    const workspace = $(".workspace");
    if (enabled === workspace.classList.contains("visualization-mode")) return;

    if (enabled) {
        if (workspace.classList.contains("focus-mode")) {
            setFocusMode(false);
        }
        setAnimationPreviewPlaying(false);
        visualizationPaused = false;
        visualizationLastFrame = 0;
        visualizationMotions = new Map();
        workspace.classList.add("visualization-mode");
        refreshAnimationUI();
        $("#visualizeBtn").setAttribute("aria-pressed", "true");
        $("#visualizeBtn").hidden = true;
        $("#focusModeBtn").hidden = true;
        $("#selectionStatus").hidden = true;
        $("#visualizationControls").hidden = false;
        $("#visualizationPauseBtn").textContent = "Pause";
        updateVisualizationStatus();
        visualizationDisabledControls = new Map(
            [
                "#undoBtn",
                "#redoBtn",
                "#addLevelBtn",
                "#duplicateLevelBtn",
                "#renameLevelBtn",
                "#deleteLevelBtn",
                "#importBtn"
            ].map(selector => [selector, $(selector).disabled])
        );
        visualizationDisabledControls.forEach((_wasDisabled, selector) => {
            $(selector).disabled = true;
        });
        $("#mapCanvas").style.cursor = "default";
        requestAnimationFrame(() => {
            fitMapToView();
            if (!visualizationFrame) {
                visualizationFrame = requestAnimationFrame(
                    renderVisualizationFrame
                );
            }
        });
        return;
    }

    workspace.classList.remove("visualization-mode");
    refreshAnimationUI();
    $("#visualizeBtn").setAttribute("aria-pressed", "false");
    $("#visualizeBtn").hidden = false;
    $("#focusModeBtn").hidden = false;
    $("#selectionStatus").hidden = false;
    $("#visualizationControls").hidden = true;
    visualizationDisabledControls?.forEach((wasDisabled, selector) => {
        $(selector).disabled = wasDisabled;
    });
    visualizationDisabledControls = null;
    visualizationPaused = false;
    visualizationLastFrame = 0;
    visualizationMotions = new Map();
    if (visualizationFrame) {
        cancelAnimationFrame(visualizationFrame);
        visualizationFrame = 0;
    }
    render();
}

function resetVisualization() {
    visualizationMotions = new Map();
    visualizationLastFrame = 0;
    updateVisualizationStatus();
    render({
        previewPositions: getVisualizationPositions(),
        visualizationMode: true
    });
}

function activateLayerType(type) {
    const typeNames = {
        tiles: "Tuiles",
        entities: "Entités",
        collisions: "Collisions"
    };
    const matchesTypeName = {
        tiles: name => /tuil/i.test(name),
        entities: name => /entit/i.test(name),
        collisions: name => /collision/i.test(name)
    };
    let layer = state.layers.find(
        item => item.id === state.activeLayerId &&
            item.type === type &&
            !item.locked &&
            item.visible
    ) || state.layers.find(
        item => item.type === type &&
            item.name === typeNames[type] &&
            !item.locked &&
            item.visible
    ) || state.layers.find(
        item => item.type === type &&
            matchesTypeName[type](item.name) &&
            !item.locked &&
            item.visible
    ) || state.layers.find(
        item => item.type === type && !item.locked && item.visible
    );
    if (!layer) {
        const matchingLayers = state.layers.filter(item => item.type === type);
        layer = matchingLayers.find(item => !item.locked);
        if (layer) {
            layer.visible = true;
        } else if (matchingLayers.length) {
            const typeDescriptions = {
                tiles: "de tuiles",
                entities: "d’entités",
                collisions: "de collisions"
            };
            $("#layerStatus").textContent =
                `Tous les calques ${typeDescriptions[type]} sont verrouillés. Déverrouille-en un pour continuer.`;
            return false;
        } else {
            layer = {
                id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: typeNames[type],
                type,
                visible: true,
                locked: false
            };
            state.layers.push(layer);
        }
    }

    state.activeLayerId = layer.id;
    state.selectedId = null;
    refreshUI();
    render();
    return true;
}

function activeEntityType() {
    return state.entityTypes.find(
        type => type.id === state.selectedEntityTypeId
    );
}

function entityAppearance(object, type) {
    return object?.imageOverride
        ? {
            imageAssetId: object.imageAssetId || null,
            imageRegion: object.imageRegion || null
        }
        : type;
}

function setEntityInstanceImage(object, imageAssetId, imageRegion) {
    if (!object || object.kind !== "entity") return;
    const type = state.entityTypes.find(
        item => item.id === object.entityTypeId
    );
    if (!type) return;

    const centerX = object.x + object.w / 2;
    const centerY = object.y + object.h / 2;
    const appearance = { imageAssetId, imageRegion };
    const { width, height } = entityImageSize(
        type,
        state.assets,
        state.gridSize,
        appearance
    );
    object.imageOverride = true;
    object.imageAssetId = imageAssetId;
    object.imageRegion = imageRegion;
    object.w = width;
    object.h = height;
    object.x = centerX - width / 2;
    object.y = centerY - height / 2;
    syncCurrentLevel();
    saveHistory();
    refreshUI();
    render();
}

function forEachEntityObject(typeId, callback) {
    syncCurrentLevel();
    state.levels.forEach(level => {
        level.data.objects
            .filter(object => object.kind === "entity" && object.entityTypeId === typeId)
            .forEach(callback);
    });
    state.objects
        .filter(object => object.kind === "entity" && object.entityTypeId === typeId)
        .forEach(callback);
}

function entityFieldDefault(type) {
    if (type === "number") return 0;
    if (type === "boolean") return false;
    if (type === "direction") return "right";
    return "";
}

function movementBehaviorId() {
    return `behavior_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createMovementBehavior(name) {
    const trimmedName = name.trim();
    if (!trimmedName) {
        alert("Le nom du comportement ne peut pas être vide.");
        return null;
    }
    const behavior = {
        id: movementBehaviorId(),
        name: trimmedName,
        type: "patrol",
        deltaX: 128,
        deltaY: 0,
        speed: 60
    };
    state.behaviors.push(behavior);
    state.selectedBehaviorId = behavior.id;
    return behavior;
}

function behaviorOptionMarkup(includeNone = false) {
    return [
        includeNone
            ? '<option value="">Aucun comportement (immobile)</option>'
            : '<option value="">Aucun · les prochaines entités restent immobiles</option>',
        ...state.behaviors.map(behavior =>
            `<option value="${escapeHTML(behavior.id)}">${
                escapeHTML(behavior.name)
            }</option>`
        )
    ].join("");
}

function fieldValueControl(field, value, className = "") {
    const id = escapeHTML(field.id);
    if (field.type === "boolean") {
        return `<input class="${className}" data-field-id="${id}" type="checkbox" ${
            value ? "checked" : ""
        }>`;
    }
    if (field.type === "direction") {
        return `<select class="${className}" data-field-id="${id}">
            ${["right", "left", "up", "down"].map(direction => `
                <option value="${direction}" ${
                    value === direction ? "selected" : ""
                }>${direction}</option>
            `).join("")}
        </select>`;
    }
    return `<input class="${className}" data-field-id="${id}"
        type="${field.type === "number" ? "number" : "text"}"
        value="${escapeHTML(value ?? "")}">`;
}

function updateEntityTypeUI() {
    const select = $("#entityTypeSelect");
    const previousId = state.selectedEntityTypeId;
    select.replaceChildren();
    state.entityTypes.forEach(type => {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.name;
        select.append(option);
    });
    state.selectedEntityTypeId = state.entityTypes.some(
        type => type.id === previousId
    ) ? previousId : state.entityTypes[0]?.id || null;
    select.value = state.selectedEntityTypeId || "";
    const type = activeEntityType();
    $("#entityTypeName").value = type?.name || "";
    $("#entityTypeColor").value = type?.color || "#55d69e";
    $("#entityTypeName").disabled = !type;
    $("#entityTypeColor").disabled = !type;
    $("#deleteEntityTypeBtn").disabled = !type;
    $("#addEntityFieldBtn").disabled = !type;
    const imageSelect = $("#entityTypeImage");
    imageSelect.replaceChildren();
    const noImageOption = document.createElement("option");
    noImageOption.value = "";
    noImageOption.textContent = "Aucune image";
    imageSelect.append(noImageOption);
    state.assets.forEach(asset => {
        const option = document.createElement("option");
        option.value = asset.id;
        option.textContent = asset.name;
        imageSelect.append(option);
    });
    imageSelect.value = type?.imageAssetId || "";
    imageSelect.disabled = !type || !state.assets.length;
    const selectedRegion = state.selectedTileRegion;
    const canUseCrop = Boolean(
        type &&
        selectedRegion &&
        state.assets.some(asset => asset.id === selectedRegion.assetId)
    );
    $("#entityTypeUseCropBtn").disabled = !canUseCrop;
    $("#entityTypeClearImageBtn").disabled = !type || !type.imageAssetId;
    const imagePreview = $("#entityTypeImagePreview");
    const typeAsset = state.assets.find(
        asset => asset.id === type?.imageAssetId
    );
    if (typeAsset?.img && type?.imageRegion) {
        const region = type.imageRegion;
        const previewScale = 48 / Math.max(region.width, region.height);
        imagePreview.innerHTML =
            `<span class="entity-type-image-crop" style="width:48px;height:48px">` +
            `<img src="${typeAsset.dataUrl}" alt="" style="left:${-region.x * previewScale}px;top:${-region.y * previewScale}px;width:${typeAsset.width * previewScale}px;height:${typeAsset.height * previewScale}px"></span>` +
            `<span>Découpe sélectionnée</span>`;
    } else if (typeAsset) {
        imagePreview.innerHTML =
            `<img class="entity-type-image-full" src="${typeAsset.dataUrl}" alt="">` +
            `<span>${escapeHTML(typeAsset.name)}</span>`;
    } else {
        imagePreview.innerHTML = "<span>Aucune image associée</span>";
    }
    imagePreview.classList.toggle("has-region", Boolean(type?.imageRegion));
    const behaviorSelect = $("#entityBehaviorTemplate");
    behaviorSelect.innerHTML = behaviorOptionMarkup();
    state.selectedBehaviorId = state.behaviors.some(
        behavior => behavior.id === state.selectedBehaviorId
    ) ? state.selectedBehaviorId : state.behaviors[0]?.id || null;
    behaviorSelect.value = state.selectedBehaviorId || "";
    behaviorSelect.disabled = !state.behaviors.length;
    behaviorSelect.onchange = () => {
        state.selectedBehaviorId = behaviorSelect.value || null;
        saveHistory();
        refreshFocusToolbar();
    };

    const behavior = state.behaviors.find(
        item => item.id === state.selectedBehaviorId
    );
    $("#movementBehaviorName").value = behavior?.name || "";
    $("#movementBehaviorDeltaX").value = behavior?.deltaX ?? 128;
    $("#movementBehaviorDeltaY").value = behavior?.deltaY ?? 0;
    $("#movementBehaviorSpeed").value = behavior?.speed ?? 60;
    [
        "#movementBehaviorName",
        "#movementBehaviorDeltaX",
        "#movementBehaviorDeltaY",
        "#movementBehaviorSpeed",
        "#deleteMovementBehaviorBtn"
    ].forEach(selector => {
        $(selector).disabled = !behavior;
    });
    $("#movementBehaviorName").onchange = () => {
        if (!behavior) return;
        const name = $("#movementBehaviorName").value.trim();
        if (!name) {
            alert("Le nom du comportement ne peut pas être vide.");
            refreshUI();
            return;
        }
        behavior.name = name;
        saveHistory();
        refreshUI();
    };
    ["DeltaX", "DeltaY", "Speed"].forEach(property => {
        const input = $(`#movementBehavior${property}`);
        input.onchange = () => {
            if (!behavior) return;
            const value = Number(input.value);
            if (!Number.isFinite(value) ||
                (property === "Speed" && value <= 0)) {
                alert(property === "Speed"
                    ? "La vitesse doit être supérieure à zéro."
                    : "Les déplacements X et Y doivent être des nombres valides.");
                refreshUI();
                return;
            }
            const deltaX = property === "DeltaX"
                ? value : Number(behavior.deltaX);
            const deltaY = property === "DeltaY"
                ? value : Number(behavior.deltaY);
            if (deltaX === 0 && deltaY === 0) {
                alert("Un déplacement doit avoir une valeur X ou Y non nulle.");
                refreshUI();
                return;
            }
            behavior[
                property === "Speed"
                    ? "speed"
                    : property[0].toLowerCase() + property.slice(1)
            ] = value;
            saveHistory();
            refreshUI();
            render();
        };
    });
    $("#addMovementBehaviorBtn").onclick = () => {
        const name = prompt("Nom du comportement réutilisable :", "Nouvelle patrouille");
        if (name === null) return;
        if (!createMovementBehavior(name)) return;
        saveHistory();
        refreshUI();
    };
    $("#deleteMovementBehaviorBtn").onclick = () => {
        if (!behavior) return;
        if (!confirm(
            `Supprimer le comportement « ${behavior.name} » et le dissocier des entités qui l’utilisent ?`
        )) return;
        syncCurrentLevel();
        state.levels.forEach(level => {
            level.data.objects.forEach(object => {
                if (object.behaviorId === behavior.id) object.behaviorId = null;
            });
        });
        state.objects.forEach(object => {
            if (object.behaviorId === behavior.id) object.behaviorId = null;
        });
        state.behaviors = state.behaviors.filter(
            item => item.id !== behavior.id
        );
        state.selectedBehaviorId = state.behaviors[0]?.id || null;
        saveHistory();
        refreshUI();
        render();
    };

    $("#entityFieldList").innerHTML = type?.fields.length
        ? type.fields.map(field => `
            <div class="entity-field-row">
                <input data-field-name="${escapeHTML(field.id)}"
                       aria-label="Nom du champ"
                       value="${escapeHTML(field.name)}">
                <select data-field-type="${escapeHTML(field.id)}"
                        aria-label="Type du champ">
                    ${[
                        ["text", "Texte"],
                        ["number", "Nombre"],
                        ["boolean", "Oui / non"],
                        ["direction", "Direction"]
                    ].map(([value, label]) => `
                        <option value="${value}" ${
                            field.type === value ? "selected" : ""
                        }>${label}</option>
                    `).join("")}
                </select>
                ${fieldValueControl(
                    field,
                    field.defaultValue ?? entityFieldDefault(field.type),
                    "entity-field-default"
                )}
                <button data-field-delete="${escapeHTML(field.id)}"
                        aria-label="Supprimer le champ ${escapeHTML(field.name)}">×</button>
            </div>
        `).join("")
        : '<p class="empty">Aucun champ configuré.</p>';

    $("#entityFieldList").querySelectorAll("[data-field-name]").forEach(input => {
        input.onchange = () => {
            const field = type.fields.find(item => item.id === input.dataset.fieldName);
            const name = input.value.trim();
            if (!field || !name) {
                alert("Le nom du champ ne peut pas être vide.");
                refreshUI();
                return;
            }
            field.name = name;
            saveHistory();
            refreshUI();
        };
    });
    $("#entityFieldList").querySelectorAll("[data-field-type]").forEach(selectField => {
        selectField.onchange = () => {
            const field = type.fields.find(item => item.id === selectField.dataset.fieldType);
            if (!field) return;
            field.type = selectField.value;
            field.defaultValue = entityFieldDefault(field.type);
            forEachEntityObject(type.id, object => {
                object.fields ||= {};
                object.fields[field.id] = field.defaultValue;
            });
            saveHistory();
            refreshUI();
        };
    });
    $("#entityFieldList").querySelectorAll(".entity-field-default").forEach(input => {
        input.onchange = () => {
            const field = type.fields.find(item => item.id === input.dataset.fieldId);
            if (!field) return;
            field.defaultValue = input.type === "checkbox"
                ? input.checked
                : input.type === "number"
                    ? Number(input.value)
                    : input.value;
            saveHistory();
        };
    });
    $("#entityFieldList").querySelectorAll("[data-field-delete]").forEach(button => {
        button.onclick = () => {
            const fieldId = button.dataset.fieldDelete;
            type.fields = type.fields.filter(field => field.id !== fieldId);
            forEachEntityObject(type.id, object => {
                if (object.fields) delete object.fields[fieldId];
            });
            saveHistory();
            refreshUI();
        };
    });
}

function createLevelId() {
    return `level_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function updateMapFields() {
    $("#mapWidth").value = state.mapWidth;
    $("#mapHeight").value = state.mapHeight;
    $("#gridSize").value = state.gridSize;
    $("#bgColor").value = state.bgColor;
}

function activateLevel(levelId, recordHistory = true) {
    if (levelId === state.currentLevelId) return;
    const level = state.levels.find(item => item.id === levelId);
    if (!level) return;

    syncCurrentLevel();
    state.currentLevelId = level.id;
    loadLevelData(level.data);
    setTool("select");
    $("#layerStatus").textContent = "";
    updateMapFields();
    resizeCanvas();
    refreshUI();
    if ($(".workspace").classList.contains("visualization-mode")) {
        fitMapToView();
        resetVisualization();
    } else {
        render();
    }
    if (recordHistory) saveHistory();
}

function addLevel(duplicate = false) {
    syncCurrentLevel();
    const source = state.levels.find(level => level.id === state.currentLevelId);
    const id = createLevelId();
    const name = duplicate
        ? `${source.name} (copie)`
        : `Niveau ${state.levels.length + 1}`;
    let data;

    if (duplicate) {
        data = JSON.parse(JSON.stringify(source.data));
    } else {
        data = {
            mapWidth: state.mapWidth,
            mapHeight: state.mapHeight,
            gridSize: state.gridSize,
            bgColor: state.bgColor,
            objects: [],
            tiles: [],
            collisionCells: [],
            collisionTypes: [],
            selectedCollisionTypeId: null,
            layers: [{
                id: `tiles_${id}`,
                name: "Tuiles",
                type: "tiles",
                visible: true,
                locked: false
            }, {
                id: `entities_${id}`,
                name: "Entités",
                type: "entities",
                visible: true,
                locked: false
            }, {
                id: `collisions_${id}`,
                name: "Collisions",
                type: "collisions",
                visible: true,
                locked: false
            }],
            activeLayerId: `tiles_${id}`,
            selectedId: null,
            selectedTileAssetId: state.selectedTileAssetId,
            selectedTileRegion: state.selectedTileRegion
                ? { ...state.selectedTileRegion }
                : null,
            nextId: 1
        };
    }

    state.levels.push({ id, name, data });
    activateLevel(id, false);
    saveHistory();
}

function renameCurrentLevel() {
    const level = state.levels.find(item => item.id === state.currentLevelId);
    if (!level) return;
    const name = prompt("Nom du niveau :", level.name);
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
        alert("Le nom du niveau ne peut pas être vide.");
        return;
    }

    level.name = trimmedName;
    saveHistory();
    refreshUI();
}

function deleteCurrentLevel() {
    if (state.levels.length <= 1) return;
    const level = state.levels.find(item => item.id === state.currentLevelId);
    if (!level || !confirm(`Supprimer le niveau « ${level.name} » ?`)) return;

    syncCurrentLevel();
    const index = state.levels.findIndex(item => item.id === level.id);
    state.levels.splice(index, 1);
    const target = state.levels[Math.max(0, index - 1)];
    state.currentLevelId = target.id;
    loadLevelData(target.data);
    setTool("select");
    updateMapFields();
    resizeCanvas();
    refreshUI();
    render();
    saveHistory();
}

function updateLayersUI() {
    const layerList = $("#layerList");
    const locked = activeLayer()?.locked;

    layerList.innerHTML = state.layers.map((layer, index) => {
        const counts = {
            tiles: state.tiles.filter(tile => tile.layerId === layer.id).length,
            entities: state.objects.filter(object => object.layerId === layer.id).length,
            collisions: state.collisionCells.filter(cell => cell.layerId === layer.id).length
        };
        const typeNames = {
            tiles: "Tuiles",
            entities: "Entités",
            collisions: "Collisions"
        };
        const count = counts[layer.type] || 0;

        return `
            <div class="layer-row ${
                layer.id === state.activeLayerId ? "active" : ""
            }">
                <button class="layer-select" data-layer-select="${layer.id}"
                        title="${escapeHTML(layer.name)}">
                    ${escapeHTML(layer.name)}
                    <small>${typeNames[layer.type]} · ${count}</small>
                </button>
                <button class="layer-toggle ${
                    layer.visible ? "" : "is-off"
                }" data-layer-visibility="${layer.id}"
                        aria-label="${layer.visible ? "Masquer" : "Afficher"} ${escapeHTML(layer.name)}"
                        title="${layer.visible ? "Masquer" : "Afficher"}">
                    ${layer.visible ? "◉" : "○"}
                </button>
                <button class="layer-toggle ${
                    layer.locked ? "is-off" : ""
                }" data-layer-lock="${layer.id}"
                        aria-label="${layer.locked ? "Déverrouiller" : "Verrouiller"} ${escapeHTML(layer.name)}"
                        title="${layer.locked ? "Déverrouiller" : "Verrouiller"}">
                    ${layer.locked ? "🔒" : "🔓"}
                </button>
                <div class="layer-actions">
                    <button data-layer-up="${layer.id}" aria-label="Monter ${escapeHTML(layer.name)}"
                            ${index === state.layers.length - 1 ? "disabled" : ""}>↑</button>
                    <button data-layer-down="${layer.id}" aria-label="Descendre ${escapeHTML(layer.name)}"
                            ${index === 0 ? "disabled" : ""}>↓</button>
                    <button data-layer-rename="${layer.id}" aria-label="Renommer ${escapeHTML(layer.name)}">✎</button>
                    <button data-layer-delete="${layer.id}" aria-label="Supprimer ${escapeHTML(layer.name)}"
                            ${state.layers.length === 1 ? "disabled" : ""}>×</button>
                </div>
            </div>
        `;
    }).join("");

    layerList.querySelectorAll("[data-layer-select]").forEach(button => {
        button.onclick = () => {
            state.activeLayerId = button.dataset.layerSelect;
            state.selectedId = null;
            setTool("select");
            $("#layerStatus").textContent = "";
            refreshUI();
            render();
        };
    });

    layerList.querySelectorAll("[data-layer-visibility]").forEach(button => {
        button.onclick = () => {
            const layer = state.layers.find(
                item => item.id === button.dataset.layerVisibility
            );
            if (!layer) return;
            layer.visible = !layer.visible;
            if (!layer.visible && state.selectedId) {
                const selected = state.objects.find(
                    object => object.id === state.selectedId
                );
                if (selected?.layerId === layer.id) state.selectedId = null;
            }
            saveHistory();
            refreshUI();
            render();
        };
    });

    layerList.querySelectorAll("[data-layer-lock]").forEach(button => {
        button.onclick = () => {
            const layer = state.layers.find(
                item => item.id === button.dataset.layerLock
            );
            if (!layer) return;
            layer.locked = !layer.locked;
            if (layer.locked && state.selectedId) {
                const selected = state.objects.find(
                    object => object.id === state.selectedId
                );
                if (selected?.layerId === layer.id) state.selectedId = null;
            }
            saveHistory();
            refreshUI();
            render();
        };
    });

    layerList.querySelectorAll("[data-layer-up], [data-layer-down]")
        .forEach(button => {
            button.onclick = () => {
                const id = button.dataset.layerUp || button.dataset.layerDown;
                const index = state.layers.findIndex(layer => layer.id === id);
                const target = button.dataset.layerUp ? index + 1 : index - 1;
                if (index < 0 || target < 0 || target >= state.layers.length) {
                    return;
                }
                [state.layers[index], state.layers[target]] =
                    [state.layers[target], state.layers[index]];
                saveHistory();
                refreshUI();
                render();
            };
        });

    layerList.querySelectorAll("[data-layer-rename]").forEach(button => {
        button.onclick = () => {
            const layer = state.layers.find(
                item => item.id === button.dataset.layerRename
            );
            if (!layer) return;
            const name = prompt("Nom du calque :", layer.name);
            if (name === null) return;
            const trimmedName = name.trim();
            if (!trimmedName) {
                alert("Le nom du calque ne peut pas être vide.");
                return;
            }
            layer.name = trimmedName;
            saveHistory();
            refreshUI();
        };
    });

    layerList.querySelectorAll("[data-layer-delete]").forEach(button => {
        button.onclick = () => {
            if (state.layers.length === 1) return;
            const layer = state.layers.find(
                item => item.id === button.dataset.layerDelete
            );
            if (!layer) return;
            if (!confirm(
                `Supprimer « ${layer.name} » et son contenu ?`
            )) return;

            state.layers = state.layers.filter(item => item.id !== layer.id);
            state.tiles = state.tiles.filter(tile => tile.layerId !== layer.id);
            state.objects = state.objects.filter(
                object => object.layerId !== layer.id
            );
            state.collisionCells = state.collisionCells.filter(
                cell => cell.layerId !== layer.id
            );
            if (state.activeLayerId === layer.id) {
                state.activeLayerId = state.layers[0].id;
                setTool("select");
            }
            if (!state.objects.some(object => object.id === state.selectedId)) {
                state.selectedId = null;
            }
            saveHistory();
            refreshUI();
            render();
        };
    });

    const layer = activeLayer();
    const statusText = !layer
        ? "Aucun calque sélectionné."
        : locked
            ? "Calque verrouillé : modification impossible."
            : `Calque ${{
                tiles: "de tuiles",
                entities: "d’entités",
                collisions: "de collisions"
            }[layer.type] || "spécialisé"}.`;
    $("#layerStatus").textContent = statusText
        ? statusText
        : "";
}

function refreshAnimationUI() {
    const select = $("#animationSelect");
    const selectedId = state.selectedAnimationId;
    select.replaceChildren();
    state.animations.forEach(animation => {
        const option = document.createElement("option");
        option.value = animation.id;
        option.textContent = animation.name;
        select.append(option);
    });

    if (!state.animations.some(animation => animation.id === selectedId)) {
        state.selectedAnimationId = state.animations[0]?.id || null;
    }
    select.value = state.selectedAnimationId || "";
    select.disabled = !state.animations.length;
    const animation = state.animations.find(
        item => item.id === state.selectedAnimationId
    );
    const active = activeLayer();
    const visualizationMode = $(".workspace").classList.contains(
        "visualization-mode"
    );
    const canPlace = active?.type === "entities" && !active.locked &&
        !visualizationMode;
    $("#animationPlayBtn").disabled = !animation || visualizationMode;
    $("#placeAnimationBtn").disabled = !animation || !canPlace;
    $("#deleteAnimationBtn").disabled = !animation;
    $("#animationStatus").textContent = animation
        ? `${animation.frames.length} frame(s) · lecture en boucle · ${animation.name}`
        : "Aucune animation importée.";

    $("#animationFrames").innerHTML = animation
        ? animation.frames.map((frame, index) => {
            const asset = state.assets.find(item =>
                item.id === frame.assetId
            );
            return `
                <div class="animation-frame">
                    <img src="${asset?.dataUrl || ""}" alt="">
                    <strong title="${escapeHTML(asset?.name || "Image manquante")}">
                        ${index + 1}. ${escapeHTML(asset?.name || "Image manquante")}
                    </strong>
                    <label>
                        ms
                        <input type="number" min="1" step="1"
                               data-frame-duration="${index}"
                               value="${frame.duration}">
                    </label>
                </div>
            `;
        }).join("")
        : "";

    $("#animationFrames").querySelectorAll("[data-frame-duration]")
        .forEach(input => {
            input.onchange = () => {
                const frame = animation?.frames[Number(
                    input.dataset.frameDuration
                )];
                const duration = Number(input.value);
                if (!frame) return;
                if (!Number.isFinite(duration) || duration <= 0) {
                    $("#animationStatus").textContent =
                        "La durée d’une frame doit être supérieure à 0 ms.";
                    input.value = frame.duration;
                    return;
                }
                frame.duration = duration;
                saveHistory();
                refreshAnimationUI();
                drawAnimationPreview();
            };
        });

    drawAnimationPreview();
}

export function refreshUI(updateProperties = true) {
    refreshAnimationUI();
    const levelSelect = $("#levelSelect");
    levelSelect.replaceChildren();
    state.levels.forEach(level => {
        const option = document.createElement("option");
        option.value = level.id;
        option.textContent = level.name;
        levelSelect.append(option);
    });
    levelSelect.value = state.currentLevelId;
    $("#duplicateLevelBtn").disabled = !state.levels.length;
    $("#renameLevelBtn").disabled = !state.levels.length;
    $("#deleteLevelBtn").disabled = state.levels.length <= 1;

    updateLayersUI();
    updateEntityTypeUI();
    const layer = activeLayer();
    const collisionTypeSelect = $("#collisionType");
    collisionTypeSelect.replaceChildren();
    state.collisionTypes.forEach(type => {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.name;
        collisionTypeSelect.append(option);
    });
    let selectedCollisionType = state.collisionTypes.find(
        type => type.id === state.selectedCollisionTypeId
    );
    if (!selectedCollisionType && state.collisionTypes.length) {
        state.selectedCollisionTypeId = state.collisionTypes[0].id;
        selectedCollisionType = state.collisionTypes[0];
    }
    collisionTypeSelect.value = state.selectedCollisionTypeId || "";
    collisionTypeSelect.disabled = !state.collisionTypes.length ||
        activeLayer()?.type !== "collisions";
    $("#collisionColor").value = selectedCollisionType?.color || "#f44e5c";
    $("#collisionColor").disabled = !selectedCollisionType ||
        activeLayer()?.type !== "collisions";
    const collisionOpacity = Math.max(
        0,
        Math.min(100, Number(selectedCollisionType?.opacity ?? 48))
    );
    $("#collisionOpacity").value = collisionOpacity;
    $("#collisionOpacity").disabled = !selectedCollisionType ||
        activeLayer()?.type !== "collisions";
    $("#collisionOpacityValue").value = `${collisionOpacity} %`;
    $("#deleteCollisionTypeBtn").disabled = !selectedCollisionType ||
        activeLayer()?.type !== "collisions";
    $("#renameCollisionTypeBtn").disabled = !selectedCollisionType ||
        activeLayer()?.type !== "collisions";
    $("#showCollisionGrid").checked = state.showCollisionGrid;
    $("#clearCollisionGridBtn").disabled = !layer ||
        layer.type !== "collisions" ||
        layer.locked ||
        !state.collisionCells.some(cell => cell.layerId === state.activeLayerId);
    $("#clearTileLayerBtn").disabled = !layer ||
        layer.type !== "tiles" ||
        layer.locked ||
        !state.tiles.some(tile => tile.layerId === layer.id);
    const assetList = $("#assetList");

    assetList.innerHTML = state.assets.length
        ? state.assets.map(asset => `
            <div class="asset-item ${
                asset.id === state.selectedTileAssetId ? "tile-active" : ""
            }">
                <img class="asset-thumb"
                     src="${asset.dataUrl}"
                     alt="">
                <div class="asset-meta">
                    <strong title="${escapeHTML(asset.name)}">
                        ${escapeHTML(asset.name)}
                    </strong>
                    <small>${asset.width} × ${asset.height}px</small>
                </div>
                <div class="asset-actions">
                    <button data-tile="${asset.id}">Tuile</button>
                    <button data-place="${asset.id}">Objet</button>
                </div>
            </div>
        `).join("")
        : '<div class="empty">Aucune image importée.</div>';

    assetList.querySelectorAll("[data-place]").forEach(button => {
        button.onclick = () => {
            const asset = state.assets.find(
                item => item.id === button.dataset.place
            );

            if (!asset) return;
            if (!activateLayerType("entities")) return;

            placeAsset(
                asset,
                Math.max(0, (state.mapWidth - asset.width) / 2),
                Math.max(0, (state.mapHeight - asset.height) / 2)
            );
        };
    });

    assetList.querySelectorAll("[data-tile]").forEach(button => {
        button.onclick = () => {
            if (!activateLayerType("tiles")) return;
            state.selectedTileAssetId = button.dataset.tile;
            state.selectedTileRegion = null;
            setTool("paint");
            updateSheetPreview();
            refreshUI();
        };
    });

    const activeTile = state.assets.find(
        asset => asset.id === state.selectedTileAssetId
    );

    $("#tileAssetStatus").textContent =
        `Tuile active : ${activeTile?.name || "aucune"}`;

    const sheetSelect = $("#sheetSource");
    const previousSheet = sheetSelect.value;

    sheetSelect.innerHTML =
        '<option value="">Choisir une image…</option>' +
        state.assets.map(asset => `
            <option value="${asset.id}">
                ${escapeHTML(asset.name)}
                (${asset.width} × ${asset.height})
            </option>
        `).join("");

    if (state.assets.some(asset => asset.id === previousSheet)) {
        sheetSelect.value = previousSheet;
    }
    if (
        state.selectedTileRegion &&
        state.assets.some(asset => asset.id === state.selectedTileRegion.assetId)
    ) {
        sheetSelect.value = state.selectedTileRegion.assetId;
    }

    updateSheetPreview();
    $("#useCropTileBtn").disabled = !state.assets.some(
        asset => asset.id === state.selectedTileRegion?.assetId
    );
    $("#placeCropObjectBtn").disabled = !state.assets.some(
        asset => asset.id === state.selectedTileRegion?.assetId
    );

    const activeObjects = state.objects.filter(
        object => object.layerId === state.activeLayerId
    );

    $("#objectList").innerHTML = activeObjects.length
        ? activeObjects.map(object => {
            const type = object.kind === "entity"
                ? state.entityTypes.find(
                    item => item.id === object.entityTypeId
                )
                : null;
            const appearance = entityAppearance(object, type);
            const asset = state.assets.find(item =>
                item.id === (object.kind === "entity"
                    ? appearance?.imageAssetId
                    : object.assetId)
            );

            return `
                <div class="object-item ${
                    object.id === state.selectedId ? "active" : ""
                }" data-id="${object.id}">
                    <img class="object-thumb"
                         src="${asset?.dataUrl || ""}"
                         alt="">
                    <div class="object-meta">
                        <strong>${escapeHTML(object.name)}</strong>
                        <small class="object-layer">${
                            escapeHTML(
                                state.layers.find(
                                    layer => layer.id === object.layerId
                                )?.name || "Calque"
                            )
                        }</small>
                        <small>
                            ${Math.round(object.w)} × ${Math.round(object.h)}
                            · (${Math.round(object.x)}, ${Math.round(object.y)})
                        </small>
                    </div>
                </div>
            `;
        }).join("")
        : '<div class="empty">Aucun objet sur ce calque.</div>';

    $("#objectList").querySelectorAll("[data-id]").forEach(element => {
        element.onclick = () => selectObject(element.dataset.id);
    });

    $("#objectCount").textContent = activeObjects.length;

    const object = state.objects.find(
        item => item.id === state.selectedId
    );
    const objectLayer = state.layers.find(
        layer => layer.id === object?.layerId
    );
    const objectEntityType = state.entityTypes.find(
        type => type.id === object?.entityTypeId
    );
    const objectBehavior = state.behaviors.find(
        behavior => behavior.id === object?.behaviorId
    );

    const showProperties = Boolean(object) && !objectLayer?.locked;
    $("#noSelection").hidden = showProperties;
    $("#objectProperties").hidden = !showProperties;
    $("#entityBehaviorAssignment").hidden =
        !showProperties || object?.kind !== "entity";
    $("#imageAnimationAssignment").hidden =
        !showProperties || object?.kind === "entity";
    const objectAnimationSelect = $("#objectAnimationSelect");
    objectAnimationSelect.replaceChildren();
    const noAnimationOption = document.createElement("option");
    noAnimationOption.value = "";
    noAnimationOption.textContent = "Image fixe";
    objectAnimationSelect.append(noAnimationOption);
    state.animations.forEach(animation => {
        const option = document.createElement("option");
        option.value = animation.id;
        option.textContent = animation.name;
        objectAnimationSelect.append(option);
    });
    objectAnimationSelect.value = object?.animationId || "";
    objectAnimationSelect.onchange = () => {
        if (!object || object.kind === "entity") return;
        const animation = state.animations.find(
            item => item.id === objectAnimationSelect.value
        );
        object.animationId = animation?.id || null;
        if (animation) {
            object.assetId = animation.frames[0].assetId;
            delete object.sourceX;
            delete object.sourceY;
            delete object.sourceWidth;
            delete object.sourceHeight;
        }
        saveHistory();
        refreshUI();
        render();
    };
    const instanceImage = $("#entityInstanceImage");
    instanceImage.replaceChildren();
    [
        ["type-default", "Image par défaut du type"],
        ["no-image", "Aucune image · marqueur coloré"]
    ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        instanceImage.append(option);
    });
    state.assets.forEach(asset => {
        const option = document.createElement("option");
        option.value = asset.id;
        option.textContent = asset.name;
        instanceImage.append(option);
    });
    instanceImage.value = object?.kind === "entity" && object.imageOverride
        ? object.imageAssetId || "no-image"
        : "type-default";
    instanceImage.onchange = () => {
        if (!object || object.kind !== "entity") return;
        const value = instanceImage.value;
        if (value === "type-default") {
            object.imageOverride = false;
            delete object.imageAssetId;
            delete object.imageRegion;
            const type = state.entityTypes.find(
                item => item.id === object.entityTypeId
            );
            const appearance = entityAppearance(object, type);
            const { width, height } = entityImageSize(
                type,
                state.assets,
                state.gridSize,
                appearance
            );
            const centerX = object.x + object.w / 2;
            const centerY = object.y + object.h / 2;
            object.w = width;
            object.h = height;
            object.x = centerX - width / 2;
            object.y = centerY - height / 2;
            syncCurrentLevel();
            saveHistory();
            refreshUI();
            render();
        } else {
            setEntityInstanceImage(
                object,
                value === "no-image" ? null : value,
                null
            );
        }
    };
    $("#entityInstanceUseCropBtn").disabled = !(
        object?.kind === "entity" &&
        state.selectedTileRegion &&
        state.assets.some(asset =>
            asset.id === state.selectedTileRegion.assetId
        )
    );
    $("#entityInstanceUseCropBtn").onclick = () => {
        if (!object || object.kind !== "entity") return;
        const region = state.selectedTileRegion;
        if (!region || !state.assets.some(asset =>
            asset.id === region.assetId
        )) return;
        setEntityInstanceImage(object, region.assetId, {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height
        });
    };
    const instanceAppearance = entityAppearance(object, objectEntityType);
    const instanceAsset = state.assets.find(
        asset => asset.id === instanceAppearance?.imageAssetId
    );
    const instancePreview = $("#entityInstanceImagePreview");
    if (instanceAsset?.img && instanceAppearance?.imageRegion) {
        const region = instanceAppearance.imageRegion;
        const previewScale = 48 / Math.max(region.width, region.height);
        instancePreview.innerHTML =
            `<span class="entity-type-image-crop" style="width:48px;height:48px">` +
            `<img src="${instanceAsset.dataUrl}" alt="" style="left:${-region.x * previewScale}px;top:${-region.y * previewScale}px;width:${instanceAsset.width * previewScale}px;height:${instanceAsset.height * previewScale}px"></span>` +
            "<span>Découpe de cette entité</span>";
    } else if (instanceAsset) {
        instancePreview.innerHTML =
            `<img class="entity-type-image-full" src="${instanceAsset.dataUrl}" alt="">` +
            `<span>${escapeHTML(instanceAsset.name)}</span>`;
    } else {
        instancePreview.innerHTML =
            `<span>${object?.kind === "entity" && object.imageOverride
                ? "Marqueur coloré pour cette entité"
                : "Apparence par défaut du type"
            }</span>`;
    }
    const instanceBehavior = $("#entityInstanceBehavior");
    instanceBehavior.innerHTML = behaviorOptionMarkup(true);
    instanceBehavior.value = object?.kind === "entity"
        ? object.behaviorId || ""
        : "";
    instanceBehavior.onchange = () => {
        if (!object || object.kind !== "entity") return;
        object.behaviorId = instanceBehavior.value || null;
        saveHistory();
        refreshUI();
        render();
    };
    $("#entityBehaviorStatus").textContent = objectBehavior
        ? `${objectBehavior.name} · ΔX ${objectBehavior.deltaX}px · ` +
          `ΔY ${objectBehavior.deltaY}px · ${objectBehavior.speed}px/s`
        : object?.kind === "entity"
            ? "Aucun comportement associé : l’entité reste immobile."
            : "";
    $("#createBehaviorForEntityBtn").onclick = () => {
        if (!object || object.kind !== "entity") return;
        const name = prompt(
            "Nom du comportement à créer pour cette entité :",
            `${object.name} · Patrouille`
        );
        if (name === null) return;
        const behavior = createMovementBehavior(name);
        if (!behavior) return;
        object.behaviorId = behavior.id;
        saveHistory();
        refreshUI();
        render();
    };

    $("#selectionStatus").textContent = object
        ? `Sélection : ${object.name}`
        : "Aucun objet sélectionné";

    refreshFocusToolbar();

    if (object && updateProperties) {
        const asset = state.assets.find(
            item => item.id === object.assetId
        );

        $("#selectedPreview").innerHTML = object.kind === "entity"
            ? `<div class="entity-preview" style="--entity-color:${
                escapeHTML(state.entityTypes.find(
                    type => type.id === object.entityTypeId
                )?.color || "#55d69e")
            }">◆ ${escapeHTML(state.entityTypes.find(
                type => type.id === object.entityTypeId
            )?.name || "Entité")}</div>`
            : asset
            ? `<img src="${asset.dataUrl}" alt="">`
            : "";

        $("#objName").value = object.name;
        $("#objX").value = Math.round(
            object.x + (object.kind === "entity" ? object.w / 2 : 0)
        );
        $("#objY").value = Math.round(
            object.y + (object.kind === "entity" ? object.h / 2 : 0)
        );
        $("#objW").value = Math.round(object.w);
        $("#objH").value = Math.round(object.h);
        $("#objVisible").checked = object.visible;
        $("#objectVisualFields").hidden = object.kind === "entity";
        $("#entityInstanceFields").innerHTML = object.kind === "entity"
            ? (objectEntityType?.fields || []).map(field => `
                <label class="field">
                    ${escapeHTML(field.name)}
                    ${fieldValueControl(
                        field,
                        object.fields?.[field.id] ??
                            field.defaultValue ??
                            entityFieldDefault(field.type),
                        "entity-instance-field"
                    )}
                </label>
            `).join("")
            : "";
        $("#entityInstanceFields")
            .querySelectorAll(".entity-instance-field")
            .forEach(input => {
                input.onchange = () => {
                    object.fields ||= {};
                    object.fields[input.dataset.fieldId] =
                        input.type === "checkbox"
                            ? input.checked
                            : input.type === "number"
                                ? Number(input.value)
                                : input.value;
                    saveHistory();
                };
            });
    } else if (!object) {
        $("#objectVisualFields").hidden = false;
        $("#entityInstanceFields").innerHTML = "";
    }
}

export function saveHistory(reset = false) {
    const snapshot = cloneData();

    if (reset) {
        state.history = [snapshot];
        state.historyIndex = 0;
        return;
    }

    const current = state.history[state.historyIndex];

    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) {
        return;
    }

    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);

    if (state.history.length > 80) {
        state.history.shift();
    }

    state.historyIndex = state.history.length - 1;
}

function historyMove(direction) {
    const next = state.historyIndex + direction;

    if (next < 0 || next >= state.history.length) return;

    const selectedTileAssetId = state.selectedTileAssetId;
    const selectedTileRegion = state.selectedTileRegion
        ? { ...state.selectedTileRegion }
        : null;
    state.historyIndex = next;
    restoreData(state.history[next]);
    state.selectedTileAssetId = selectedTileAssetId;
    state.selectedTileRegion = selectedTileRegion;

    updateMapFields();

    resizeCanvas();
    refreshUI();
}

function setTool(tool) {
    const layer = activeLayer();
    const requiredType = {
        place: "entities",
        entity: "entities",
        paint: "tiles",
        erase: "tiles",
        eyedropper: "tiles",
        fill: "tiles",
        collision: "collisions",
        collisionErase: "collisions"
    }[tool];
    if (requiredType && layer?.type !== requiredType) {
        if (!activateLayerType(requiredType)) return;
    }
    const selectedLayer = activeLayer();
    if (requiredType && selectedLayer?.locked) {
        if (!activateLayerType(requiredType)) return;
    }
    if (tool === "entity" && !activeEntityType()) {
        $("#layerStatus").textContent = "Crée ou sélectionne un type d’entité.";
        return;
    }

    const workflow = {
        select: "edit",
        delete: "edit",
        collision: "edit",
        collisionErase: "edit",
        entity: "entities",
        place: "images",
        paint: "images",
        erase: "images",
        eyedropper: "images",
        fill: "images"
    }[tool];
    if (workflow) {
        document.querySelectorAll(".workflow-group").forEach(group => {
            group.open = group.dataset.workflow === workflow;
        });
    }

    state.tool = tool;
    if (tool === "collision" || tool === "collisionErase") {
        state.showCollisionGrid = true;
        $("#showCollisionGrid").checked = true;
        render();
    }

    document.querySelectorAll(".tool").forEach(button => {
        button.classList.toggle("active", button.dataset.tool === tool);
    });

    const cursors = {
        select: "default",
        place: "copy",
        entity: "crosshair",
        paint: "cell",
        eyedropper: "copy",
        fill: "cell",
        collision: "cell",
        collisionErase: "not-allowed",
        erase: "not-allowed",
        delete: "not-allowed"
    };

    $("#mapCanvas").style.cursor = cursors[tool] || "default";
    refreshFocusToolbar();
}

function updateObjectFromFields() {
    const object = state.objects.find(
        item => item.id === state.selectedId
    );

    if (!object || state.layers.find(
        layer => layer.id === object.layerId
    )?.locked) return;

    object.name = $("#objName").value || "Objet";
    if (object.kind === "entity") {
        object.x = (Number($("#objX").value) || 0) - object.w / 2;
        object.y = (Number($("#objY").value) || 0) - object.h / 2;
    } else {
        object.x = Number($("#objX").value) || 0;
        object.y = Number($("#objY").value) || 0;
        object.w = Math.max(1, Number($("#objW").value) || 1);
        object.h = Math.max(1, Number($("#objH").value) || 1);
    }
    object.visible = $("#objVisible").checked;

    saveHistory();
    render();
    refreshUI();
}

// Importer des images
$("#imageInput").addEventListener("change", async event => {
    try {
        for (const file of event.target.files) {
            await addAsset(file);
        }

        refreshUI();
        saveHistory();
    } catch (error) {
        alert(error.message);
    }

    event.target.value = "";
});

// Outils
document.querySelectorAll(".tool").forEach(button => {
    button.onclick = () => setTool(button.dataset.tool);
});

$("#snapToggle").onchange = event => {
    state.snap = event.target.checked;
};

$("#brushSize").onchange = event => {
    state.brushSize = Math.max(
        1,
        Math.min(16, Math.floor(Number(event.target.value) || 1))
    );
    event.target.value = state.brushSize;
};

$("#collisionType").onchange = event => {
    state.selectedCollisionTypeId = event.target.value || null;
    const type = state.collisionTypes.find(
        item => item.id === state.selectedCollisionTypeId
    );
    $("#collisionColor").value = type?.color || "#f44e5c";
};

$("#entityTypeSelect").onchange = event => {
    state.selectedEntityTypeId = event.target.value || null;
    saveHistory();
    refreshUI();
};

$("#addEntityTypeBtn").onclick = () => {
    const name = prompt("Nom du nouveau type d’entité :", "");
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
        alert("Le nom du type ne peut pas être vide.");
        return;
    }
    const type = {
        id: `entity_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmedName,
        color: "#55d69e",
        imageAssetId: null,
        imageRegion: null,
        behavior: normalizeEntityBehavior(),
        fields: []
    };
    state.entityTypes.push(type);
    state.selectedEntityTypeId = type.id;
    saveHistory();
    refreshUI();
};

$("#entityTypeName").onchange = event => {
    const type = activeEntityType();
    const name = event.target.value.trim();
    if (!type) return;
    if (!name) {
        alert("Le nom du type ne peut pas être vide.");
        refreshUI();
        return;
    }
    type.name = name;
    saveHistory();
    refreshUI();
};

$("#entityTypeColor").onchange = event => {
    const type = activeEntityType();
    if (!type) return;
    type.color = event.target.value;
    saveHistory();
    refreshUI();
    render();
};

$("#entityTypeImage").onchange = event => {
    const type = activeEntityType();
    if (!type) return;
    setEntityTypeImage(type, event.target.value || null, null);
    saveHistory();
    refreshUI();
    render();
};

$("#entityTypeUseCropBtn").onclick = () => {
    const type = activeEntityType();
    const region = state.selectedTileRegion;
    if (
        !type ||
        !region ||
        !state.assets.some(asset => asset.id === region.assetId)
    ) return;
    setEntityTypeImage(type, region.assetId, {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height
    });
    saveHistory();
    refreshUI();
    render();
};

$("#entityTypeClearImageBtn").onclick = () => {
    const type = activeEntityType();
    if (!type) return;
    setEntityTypeImage(type, null, null);
    saveHistory();
    refreshUI();
    render();
};

function setEntityTypeImage(type, assetId, imageRegion) {
    syncCurrentLevel();
    type.imageAssetId = assetId;
    type.imageRegion = imageRegion;
    const { width, height } = entityImageSize(
        type,
        state.assets,
        state.gridSize
    );
    forEachEntityObject(type.id, object => {
        if (object.imageOverride) return;
        const centerX = object.x + object.w / 2;
        const centerY = object.y + object.h / 2;
        object.w = width;
        object.h = height;
        object.x = centerX - width / 2;
        object.y = centerY - height / 2;
    });
}

$("#deleteEntityTypeBtn").onclick = () => {
    const type = activeEntityType();
    if (!type) return;
    syncCurrentLevel();
    const instances = state.levels.reduce((count, level) =>
        count + level.data.objects.filter(object =>
            object.kind === "entity" && object.entityTypeId === type.id
        ).length, 0
    );
    if (!confirm(
        `Supprimer le type « ${type.name} » et ses entités (${instances}) ?`
    )) return;

    state.entityTypes = state.entityTypes.filter(item => item.id !== type.id);
    state.levels.forEach(level => {
        level.data.objects = level.data.objects.filter(object =>
            object.kind !== "entity" || object.entityTypeId !== type.id
        );
        if (!level.data.objects.some(object =>
            object.id === level.data.selectedId
        )) {
            level.data.selectedId = null;
        }
    });
    state.objects = state.objects.filter(object =>
        object.kind !== "entity" || object.entityTypeId !== type.id
    );
    state.selectedEntityTypeId = state.entityTypes[0]?.id || null;
    state.selectedId = null;
    saveHistory();
    refreshUI();
    render();
};

$("#addEntityFieldBtn").onclick = () => {
    const type = activeEntityType();
    const name = $("#newEntityFieldName").value.trim();
    if (!type) return;
    if (!name) {
        alert("Saisis un nom pour le champ.");
        return;
    }
    if (type.fields.some(field => field.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        alert("Ce type possède déjà un champ avec ce nom.");
        return;
    }
    const fieldType = $("#newEntityFieldType").value;
    const field = {
        id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        type: fieldType,
        defaultValue: entityFieldDefault(fieldType)
    };
    type.fields.push(field);
    forEachEntityObject(type.id, object => {
        object.fields ||= {};
        object.fields[field.id] = field.defaultValue;
    });
    $("#newEntityFieldName").value = "";
    saveHistory();
    refreshUI();
};

$("#addCollisionTypeBtn").onclick = () => {
    const name = prompt("Nom de la nouvelle grille de gameplay :", "");
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
        alert("Le nom de la grille ne peut pas être vide.");
        return;
    }

    const type = {
        id: `gameplay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmedName,
        color: "#f44e5c",
        opacity: 48
    };
    state.collisionTypes.push(type);
    state.selectedCollisionTypeId = type.id;
    let collisionLayer = state.layers.find(
        layer => layer.type === "collisions"
    );
    if (!collisionLayer) {
        collisionLayer = {
            id: `collisions_${Date.now()}`,
            name: "Collisions",
            type: "collisions",
            visible: true,
            locked: false
        };
        state.layers.push(collisionLayer);
    }
    state.activeLayerId = collisionLayer.id;
    setTool("collision");
    saveHistory();
    refreshUI();
    render();
};

$("#renameCollisionTypeBtn").onclick = () => {
    const type = state.collisionTypes.find(
        item => item.id === state.selectedCollisionTypeId
    );
    if (!type) return;
    const name = prompt("Nouveau nom de la grille :", type.name);
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
        alert("Le nom de la grille ne peut pas être vide.");
        return;
    }

    type.name = trimmedName;
    saveHistory();
    refreshUI();
    render();
};

$("#deleteCollisionTypeBtn").onclick = () => {
    const type = state.collisionTypes.find(
        item => item.id === state.selectedCollisionTypeId
    );
    if (!type) return;

    const cellCount = state.collisionCells.filter(
        cell => cell.typeId === type.id
    ).length;
    if (!confirm(
        `Supprimer la grille « ${type.name} » et ses ${cellCount} case(s) ?`
    )) return;

    state.collisionTypes = state.collisionTypes.filter(
        item => item.id !== type.id
    );
    state.collisionCells = state.collisionCells.filter(
        cell => cell.typeId !== type.id
    );
    state.selectedCollisionTypeId = state.collisionTypes[0]?.id || null;
    saveHistory();
    refreshUI();
    render();
};

$("#collisionColor").onchange = event => {
    const type = state.collisionTypes.find(
        item => item.id === state.selectedCollisionTypeId
    );
    if (!type) return;

    type.color = event.target.value;
    saveHistory();
    render();
};

$("#collisionOpacity").oninput = event => {
    const type = state.collisionTypes.find(
        item => item.id === state.selectedCollisionTypeId
    );
    if (!type) return;

    type.opacity = Number(event.target.value);
    $("#collisionOpacityValue").value = `${type.opacity} %`;
    render();
};

$("#collisionOpacity").onchange = () => saveHistory();

$("#showCollisionGrid").onchange = event => {
    state.showCollisionGrid = event.target.checked;
    render();
};

$("#clearCollisionGridBtn").onclick = () => {
    const layer = activeLayer();
    if (!layer || layer.type !== "collisions" || layer.locked) return;
    const layerCells = state.collisionCells.filter(
        cell => cell.layerId === layer.id
    );
    if (!layerCells.length) return;
    if (!confirm(
        `Effacer les ${layerCells.length} cases du calque « ${layer.name} » ?`
    )) return;

    state.collisionCells = state.collisionCells.filter(
        cell => cell.layerId !== layer.id
    );
    saveHistory();
    refreshUI();
    render();
};

$("#clearTileLayerBtn").onclick = () => {
    const layer = activeLayer();
    if (!layer || layer.locked) return;

    const tileCount = state.tiles.filter(
        tile => tile.layerId === layer.id
    ).length;
    if (!tileCount) return;

    if (!confirm(
        `Effacer les ${tileCount} tuile(s) du calque « ${layer.name} » ?`
    )) return;

    state.tiles = state.tiles.filter(tile => tile.layerId !== layer.id);
    $("#layerStatus").textContent = "";
    saveHistory();
    refreshUI();
    render();
};

$("#levelSelect").onchange = event => {
    activateLevel(event.target.value);
};

$("#addLevelBtn").onclick = () => addLevel();
$("#duplicateLevelBtn").onclick = () => addLevel(true);
$("#renameLevelBtn").onclick = renameCurrentLevel;
$("#deleteLevelBtn").onclick = deleteCurrentLevel;

$("#useCropTileBtn").onclick = () => {
    const region = state.selectedTileRegion;
    const asset = state.assets.find(item => item.id === region?.assetId);
    if (!asset || !region || !activateLayerType("tiles")) return;

    state.selectedTileAssetId = asset.id;
    setTool("paint");
    refreshUI();
    $("#sheetStatus").textContent =
        "Découpe active : clique ou fais glisser sur la carte pour peindre.";
};

$("#placeCropObjectBtn").onclick = () => {
    const region = state.selectedTileRegion;
    const asset = state.assets.find(item => item.id === region?.assetId);
    if (!asset || !region || !activateLayerType("entities")) return;

    placeAssetRegion(
        asset,
        region,
        Math.max(0, (state.mapWidth - region.width) / 2),
        Math.max(0, (state.mapHeight - region.height) / 2)
    );
};

$("#addLayerBtn").onclick = () => {
    const type = $("#newLayerType").value;
    const names = {
        tiles: "Tuiles",
        entities: "Entités",
        collisions: "Collisions"
    };
    const count = state.layers.filter(layer => layer.type === type).length + 1;
    const layer = {
        id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: count === 1 ? names[type] : `${names[type]} ${count}`,
        type,
        visible: true,
        locked: false
    };
    state.layers.push(layer);
    state.activeLayerId = layer.id;
    state.selectedId = null;
    setTool("select");
    saveHistory();
    refreshUI();
    render();
};

$("#bgColor").oninput = event => {
    state.bgColor = event.target.value;
    render();
};

// Dimensions de la carte
$("#resizeMapBtn").onclick = () => {
    state.mapWidth = Math.max(
        128,
        Math.min(8192, Number($("#mapWidth").value) || 1600)
    );

    state.mapHeight = Math.max(
        128,
        Math.min(8192, Number($("#mapHeight").value) || 900)
    );

    state.gridSize = Math.max(
        8,
        Math.min(256, Number($("#gridSize").value) || 32)
    );

    state.bgColor = $("#bgColor").value;

    resizeCanvas();
    saveHistory();
};

// Zoom
function setZoom(zoom) {
    state.zoom = Math.max(0.05, Math.min(3, zoom));

    $("#canvasStage").style.transform = `scale(${state.zoom})`;
    $("#zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
    $("#focusZoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitMapToView() {
    const viewport = $("#viewport");
    const horizontalSpace = Math.max(1, viewport.clientWidth - 56);
    const verticalSpace = Math.max(1, viewport.clientHeight - 56);
    setZoom(Math.min(
        horizontalSpace / state.mapWidth,
        verticalSpace / state.mapHeight
    ));
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
}

function refreshFocusToolbar() {
    const layerSelect = $("#focusLayerSelect");
    if (!layerSelect) return;
    layerSelect.replaceChildren();
    state.layers.forEach(layer => {
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = `${layer.name} · ${
            { tiles: "Tuiles", entities: "Entités", collisions: "Gameplay" }[layer.type]
                || "Calque"
        }${layer.locked ? " · verrouillé" : ""}`;
        option.disabled = layer.locked;
        layerSelect.append(option);
    });
    layerSelect.value = state.activeLayerId;

    const entityTypeSelect = $("#focusEntityTypeSelect");
    entityTypeSelect.replaceChildren();
    state.entityTypes.forEach(type => {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.name;
        entityTypeSelect.append(option);
    });
    entityTypeSelect.value = state.selectedEntityTypeId || "";
    entityTypeSelect.disabled = !state.entityTypes.length;

    const behaviorSelect = $("#focusBehaviorSelect");
    behaviorSelect.innerHTML = behaviorOptionMarkup();
    behaviorSelect.value = state.selectedBehaviorId || "";
    behaviorSelect.disabled = !state.behaviors.length;

    const collisionTypeSelect = $("#focusCollisionTypeSelect");
    collisionTypeSelect.replaceChildren();
    state.collisionTypes.forEach(type => {
        const option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.name;
        collisionTypeSelect.append(option);
    });
    collisionTypeSelect.value = state.selectedCollisionTypeId || "";
    collisionTypeSelect.disabled = !state.collisionTypes.length;
    $("#focusZoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;

    document.querySelectorAll("[data-focus-tool]").forEach(button => {
        button.classList.toggle("active", button.dataset.focusTool === state.tool);
    });
}

$("#zoomIn").onclick = () => setZoom(state.zoom * 1.2);
$("#zoomOut").onclick = () => setZoom(state.zoom / 1.2);
$("#resetView").onclick = () => setZoom(1);
$("#focusZoomIn").onclick = () => setZoom(state.zoom * 1.2);
$("#focusZoomOut").onclick = () => setZoom(state.zoom / 1.2);
$("#focusFit").onclick = fitMapToView;

document.querySelectorAll("[data-focus-tool]").forEach(button => {
    button.onclick = () => setTool(button.dataset.focusTool);
});

$("#focusLayerSelect").onchange = event => {
    state.activeLayerId = event.target.value;
    state.selectedId = null;
    $("#layerStatus").textContent = "";
    setTool("select");
    refreshUI();
    render();
};

$("#focusEntityTypeSelect").onchange = event => {
    state.selectedEntityTypeId = event.target.value || null;
    $("#entityTypeSelect").value = state.selectedEntityTypeId || "";
    saveHistory();
    refreshFocusToolbar();
};

$("#focusBehaviorSelect").onchange = event => {
    state.selectedBehaviorId = event.target.value || null;
    $("#entityBehaviorTemplate").value = state.selectedBehaviorId || "";
    saveHistory();
};

$("#focusCollisionTypeSelect").onchange = event => {
    state.selectedCollisionTypeId = event.target.value || null;
    $("#collisionType").value = state.selectedCollisionTypeId || "";
    const type = state.collisionTypes.find(
        item => item.id === state.selectedCollisionTypeId
    );
    $("#collisionColor").value = type?.color || "#f44e5c";
    $("#collisionOpacity").value = type?.opacity ?? 48;
    $("#collisionOpacityValue").value = `${type?.opacity ?? 48} %`;
    saveHistory();
    refreshFocusToolbar();
    render();
};

function setFocusMode(enabled) {
    $(".workspace").classList.toggle("focus-mode", enabled);
    $("#focusModeBtn").setAttribute("aria-pressed", String(enabled));
    $("#focusModeBtn").textContent = enabled ? "⤢ Quitter focus" : "⛶ Focus";
    $("#focusModeBtn").title = enabled
        ? "Quitter le mode focus (Échap)"
        : "Masquer les panneaux et agrandir la carte (F)";
}

$("#focusModeBtn").onclick = () => {
    setFocusMode(!$(".workspace").classList.contains("focus-mode"));
};

$("#visualizeBtn").onclick = () => setVisualizationMode(true);
$("#visualizationPauseBtn").onclick = () => {
    visualizationPaused = !visualizationPaused;
    visualizationLastFrame = 0;
    $("#visualizationPauseBtn").textContent = visualizationPaused
        ? "Reprendre"
        : "Pause";
};
$("#visualizationResetBtn").onclick = resetVisualization;
$("#visualizationExitBtn").onclick = () => setVisualizationMode(false);

// Importer un projet
$("#importBtn").onclick = () => $("#jsonInput").click();

$("#animationFilesInput").onchange = async event => {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;
    if (files.length < 2) {
        $("#animationStatus").textContent =
            "Choisis au moins deux images pour créer une animation.";
        return;
    }

    const firstName = files[0].name.replace(/\.[^.]+$/, "");
    const normalizedName = $("#animationNameInput").value.trim() || firstName;
    if (!normalizedName) {
        $("#animationStatus").textContent =
            "Le nom de l’animation ne peut pas être vide.";
        return;
    }
    $("#animationNameInput").value = normalizedName;

    const originalAssetIds = new Set(state.assets.map(asset => asset.id));
    try {
        const results = await Promise.allSettled(files.map(addAsset));
        const failedImport = results.find(result => result.status === "rejected");
        if (failedImport) throw failedImport.reason;
        const assets = results.map(result => result.value);
        const animation = {
            id: `animation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: normalizedName,
            frames: assets.map(asset => ({
                assetId: asset.id,
                duration: 120
            }))
        };
        state.animations.push(animation);
        state.selectedAnimationId = animation.id;
        state.animationClock = 0;
        saveHistory();
        refreshUI();
        render();
    } catch (error) {
        state.assets = state.assets.filter(asset =>
            originalAssetIds.has(asset.id)
        );
        $("#animationStatus").textContent =
            `Import de la séquence impossible : ${error.message}`;
    }
};

$("#animationSelect").onchange = event => {
    state.selectedAnimationId = event.target.value || null;
    drawAnimationPreview();
    refreshAnimationUI();
};

$("#animationPlayBtn").onclick = () => {
    if (!state.animations.some(
        animation => animation.id === state.selectedAnimationId
    )) return;
    setAnimationPreviewPlaying(!animationPreviewPlaying);
};

$("#placeAnimationBtn").onclick = () => {
    const animation = state.animations.find(
        item => item.id === state.selectedAnimationId
    );
    if (!animation || !activateLayerType("entities")) return;
    placeAnimation(
        animation,
        Math.max(0, (state.mapWidth - (state.assets.find(
            asset => asset.id === animation.frames[0].assetId
        )?.width || 1)) / 2),
        Math.max(0, (state.mapHeight - (state.assets.find(
            asset => asset.id === animation.frames[0].assetId
        )?.height || 1)) / 2)
    );
};

$("#deleteAnimationBtn").onclick = () => {
    const animation = state.animations.find(
        item => item.id === state.selectedAnimationId
    );
    if (!animation) return;
    state.objects.forEach(object => {
        if (object.animationId === animation.id) {
            object.animationId = null;
        }
    });
    state.animations = state.animations.filter(
        item => item.id !== animation.id
    );
    state.selectedAnimationId = state.animations[0]?.id || null;
    if (!state.animations.length) setAnimationPreviewPlaying(false);
    saveHistory();
    refreshUI();
    render();
};

$("#jsonInput").onchange = async event => {
    const file = event.target.files[0];

    if (!file) return;

    try {
        await importProject(file);
        refreshUI();
        render();
        saveHistory(true);
    } catch (error) {
        alert("Import impossible : " + error.message);
    }

    event.target.value = "";
};

// Exporter le projet
$("#exportBtn").onclick = exportProject;

// Annuler / rétablir
$("#undoBtn").onclick = () => historyMove(-1);
$("#redoBtn").onclick = () => historyMove(1);

$("#deleteBtn").onclick = deleteSelected;
$("#duplicateBtn").onclick = duplicateSelected;

["objName", "objX", "objY", "objW", "objH", "objVisible"]
    .forEach(id => {
        $("#" + id).addEventListener("change", updateObjectFromFields);
    });

// Raccourcis clavier
window.addEventListener("keydown", event => {
    if ($(".workspace").classList.contains("visualization-mode")) {
        if (event.key === "Escape") {
            setVisualizationMode(false);
        } else if (event.code === "Space") {
            event.preventDefault();
            visualizationPaused = !visualizationPaused;
            visualizationLastFrame = 0;
            $("#visualizationPauseBtn").textContent = visualizationPaused
                ? "Reprendre"
                : "Pause";
        } else if (event.key.toLowerCase() === "r") {
            resetVisualization();
        }
        return;
    }
    if (
        event.key === "Escape" &&
        $(".workspace").classList.contains("focus-mode")
    ) {
        setFocusMode(false);
        return;
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement.tagName
    )) {
        return;
    }

    if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFocusMode(!$(".workspace").classList.contains("focus-mode"));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        historyMove(event.shiftKey ? 1 : -1);
    } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "y"
    ) {
        event.preventDefault();
        historyMove(1);
    } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
    } else if (event.key.toLowerCase() === "v") {
        setTool("select");
    } else if (event.key.toLowerCase() === "p") {
        setTool("place");
    } else if (event.key.toLowerCase() === "b") {
        setTool("paint");
    } else if (event.key.toLowerCase() === "e") {
        setTool("erase");
    } else if (event.key.toLowerCase() === "i") {
        setTool("eyedropper");
    } else if (event.key.toLowerCase() === "g") {
        setTool("fill");
    } else if (event.key.toLowerCase() === "c") {
        setTool(event.shiftKey ? "collisionErase" : "collision");
    }
});

// Initialisation
initObjectInteractions();
initSpritesheetPreview();
resizeCanvas();
refreshUI();
saveHistory(true);
window.addEventListener("resize", () => {
    if ($(".workspace").classList.contains("visualization-mode")) {
        fitMapToView();
    }
});
