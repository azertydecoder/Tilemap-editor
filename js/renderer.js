
import { state, animationFrameAt } from "./state.js";

export const canvas = document.querySelector("#mapCanvas");
export const ctx = canvas.getContext("2d");

export function resizeCanvas() {
    canvas.width = state.mapWidth;
    canvas.height = state.mapHeight;

    const stage = document.querySelector("#canvasStage");
    stage.style.width = `${state.mapWidth}px`;
    stage.style.height = `${state.mapHeight}px`;

    document.querySelector("#mapInfo").textContent =
        `${state.mapWidth} × ${state.mapHeight} px`;

    render();
}

export function render(options = {}) {
    const previewPositions = options.previewPositions;
    const visualizationMode = options.visualizationMode === true;
    const animationTime = options.animationTime ?? state.animationClock ?? 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Arrière-plan
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grille
    if (!visualizationMode) {
        ctx.save();
        ctx.strokeStyle = "rgba(200, 215, 240, 0.09)";
        ctx.lineWidth = 1;

        for (let x = 0; x <= state.mapWidth; x += state.gridSize) {
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, state.mapHeight);
            ctx.stroke();
        }

        for (let y = 0; y <= state.mapHeight; y += state.gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(state.mapWidth, y + 0.5);
            ctx.stroke();
        }

        ctx.restore();
    }

    for (const layer of state.layers) {
        if (!layer.visible) continue;

        if (layer.type === "tiles") {
            for (const tile of state.tiles) {
                if (tile.layerId !== layer.id) continue;
                const asset = state.assets.find(
                    item => item.id === tile.assetId
                );

                if (asset?.img) {
                    if (tile.sourceWidth > 0 && tile.sourceHeight > 0) {
                        ctx.drawImage(
                            asset.img,
                            tile.sourceX,
                            tile.sourceY,
                            tile.sourceWidth,
                            tile.sourceHeight,
                            tile.x,
                            tile.y,
                            state.gridSize,
                            state.gridSize
                        );
                    } else {
                        ctx.drawImage(
                            asset.img,
                            tile.x,
                            tile.y,
                            state.gridSize,
                            state.gridSize
                        );
                    }
                }
            }
        }

        if (layer.type === "entities") {
            for (const object of state.objects) {
                if (object.layerId !== layer.id || !object.visible) continue;
                const previewPosition = previewPositions?.get(object.id);
                const objectX = previewPosition?.x ?? object.x;
                const objectY = previewPosition?.y ?? object.y;

                if (object.kind === "entity") {
                    const type = state.entityTypes.find(
                        item => item.id === object.entityTypeId
                    );
                    const appearance = object.imageOverride
                        ? object
                        : type;
                    const asset = state.assets.find(
                        item => item.id === appearance?.imageAssetId
                    );

                    if (asset?.img) {
                        const region = appearance.imageRegion;
                        if (region) {
                            ctx.drawImage(
                                asset.img,
                                region.x,
                                region.y,
                                region.width,
                                region.height,
                                objectX,
                                objectY,
                                object.w,
                                object.h
                            );
                        } else {
                            ctx.drawImage(
                                asset.img,
                                objectX,
                                objectY,
                                object.w,
                                object.h
                            );
                        }
                    } else {
                        const centerX = objectX + object.w / 2;
                        const centerY = objectY + object.h / 2;
                        ctx.save();
                        ctx.fillStyle = type?.color || "#55d69e";
                        ctx.strokeStyle = "#10251e";
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(
                            centerX,
                            centerY,
                            Math.min(object.w, object.h) / 2,
                            0,
                            Math.PI * 2
                        );
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = "#07130f";
                        ctx.font = "bold 14px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(
                            type?.name?.slice(0, 1).toUpperCase() || "E",
                            centerX,
                            centerY
                        );
                        ctx.restore();
                    }
                } else {
                    const animation = state.animations.find(
                        item => item.id === object.animationId
                    );
                    const frame = animation
                        ? animationFrameAt(animation, animationTime)
                        : null;
                    const asset = state.assets.find(item =>
                        item.id === (frame?.assetId || object.assetId)
                    );

                    if (asset?.img) {
                        if (
                            !frame &&
                            object.sourceWidth > 0 &&
                            object.sourceHeight > 0
                        ) {
                            ctx.drawImage(
                                asset.img,
                                object.sourceX,
                                object.sourceY,
                                object.sourceWidth,
                                object.sourceHeight,
                                objectX,
                                objectY,
                                object.w,
                                object.h
                            );
                        } else {
                            ctx.drawImage(
                                asset.img,
                                objectX,
                                objectY,
                                object.w,
                                object.h
                            );
                        }
                    }
                }

                if (!visualizationMode && object.id === state.selectedId) {
                    ctx.save();

                    if (object.kind === "entity") {
                        const behavior = state.behaviors.find(
                            item => item.id === object.behaviorId
                        );
                        const deltaX = Number(behavior?.deltaX);
                        const deltaY = Number(behavior?.deltaY);

                        if (
                            behavior?.type === "patrol" &&
                            Number.isFinite(deltaX) &&
                            Number.isFinite(deltaY) &&
                            (deltaX !== 0 || deltaY !== 0)
                        ) {
                            const startX = object.x + object.w / 2;
                            const startY = object.y + object.h / 2;
                            const endX = startX + deltaX;
                            const endY = startY + deltaY;

                            ctx.strokeStyle = "rgba(126, 224, 193, 0.9)";
                            ctx.fillStyle = "rgba(126, 224, 193, 0.18)";
                            ctx.lineWidth = 2;
                            ctx.setLineDash([7, 5]);
                            ctx.beginPath();
                            ctx.moveTo(startX, startY);
                            ctx.lineTo(endX, endY);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.fillRect(
                                endX - object.w / 2,
                                endY - object.h / 2,
                                object.w,
                                object.h
                            );
                            ctx.strokeRect(
                                endX - object.w / 2,
                                endY - object.h / 2,
                                object.w,
                                object.h
                            );
                        }
                    }

                    ctx.strokeStyle = "#39b8c8";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 3]);

                    ctx.strokeRect(
                        object.x + 0.5,
                        object.y + 0.5,
                        object.w,
                        object.h
                    );

                    ctx.setLineDash([]);

                    const size = 8;
                    const handles = object.kind === "entity" ? [] : [
                        [object.x, object.y],
                        [object.x + object.w / 2, object.y],
                        [object.x + object.w, object.y],
                        [object.x + object.w, object.y + object.h / 2],
                        [object.x + object.w, object.y + object.h],
                        [object.x + object.w / 2, object.y + object.h],
                        [object.x, object.y + object.h],
                        [object.x, object.y + object.h / 2]
                    ];

                    handles.forEach(([x, y]) => {
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(
                            x - size / 2,
                            y - size / 2,
                            size,
                            size
                        );
                        ctx.strokeStyle = "#168c9a";
                        ctx.strokeRect(
                            x - size / 2,
                            y - size / 2,
                            size,
                            size
                        );
                    });

                    ctx.restore();
                }
            }
        }

        if (
            layer.type === "collisions" &&
            (state.showCollisionGrid || visualizationMode)
        ) {
            const collisionTypes = new Map(
                state.collisionTypes.map(type => [type.id, type])
            );

            for (const cell of state.collisionCells) {
                if (cell.layerId !== layer.id) continue;
                const type = collisionTypes.get(cell.typeId);
                if (!type) continue;
                const opacity = Math.max(
                    0,
                    Math.min(100, Number(type.opacity ?? 48))
                ) / 100;
                if (opacity === 0) continue;

                ctx.globalAlpha = opacity;
                ctx.fillStyle = type.color;
                ctx.fillRect(
                    cell.x + 1,
                    cell.y + 1,
                    state.gridSize - 2,
                    state.gridSize - 2
                );
                if (state.gridSize >= 18) {
                    ctx.fillStyle = "#ffffff";
                    ctx.font = `bold ${Math.max(10, state.gridSize * 0.45)}px sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(
                        type.name.slice(0, 2).toUpperCase(),
                        cell.x + state.gridSize / 2,
                        cell.y + state.gridSize / 2
                    );
                }
                ctx.globalAlpha = 1;
            }
        }
    }
}

export function screenToMap(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
    };
}
