import { state } from "./state.js";

const $ = selector => document.querySelector(selector);
let sheetZoom = 1;

function cropInputs() {
    return {
        x: $("#sheetCropX"),
        y: $("#sheetCropY"),
        width: $("#sheetTileW"),
        height: $("#sheetTileH")
    };
}

function selectedAsset() {
    return state.assets.find(
        asset => asset.id === $("#sheetSource")?.value
    );
}

function clampCrop(asset, crop) {
    const imageWidth = asset.img.naturalWidth;
    const imageHeight = asset.img.naturalHeight;
    const width = Math.max(1, Math.min(imageWidth, Math.round(crop.width)));
    const height = Math.max(1, Math.min(imageHeight, Math.round(crop.height)));
    const x = Math.max(0, Math.min(imageWidth - width, Math.round(crop.x)));
    const y = Math.max(0, Math.min(imageHeight - height, Math.round(crop.y)));

    return { assetId: asset.id, x, y, width, height };
}

function updateCropFromInputs() {
    const asset = selectedAsset();
    if (!asset?.img?.naturalWidth) {
        state.selectedTileRegion = null;
        updateSheetPreview();
        return;
    }

    const inputs = cropInputs();
    state.selectedTileRegion = clampCrop(asset, {
        x: Number(inputs.x.value) || 0,
        y: Number(inputs.y.value) || 0,
        width: Number(inputs.width.value) || 1,
        height: Number(inputs.height.value) || 1
    });
    updateSheetPreview();
}

function setCropFromPointer(event, image) {
    const rect = image.getBoundingClientRect();
    const scaleX = image.naturalWidth / rect.width;
    const scaleY = image.naturalHeight / rect.height;

    return {
        x: Math.max(0, Math.min(
            image.naturalWidth - 1,
            Math.floor((event.clientX - rect.left) * scaleX)
        )),
        y: Math.max(0, Math.min(
            image.naturalHeight - 1,
            Math.floor((event.clientY - rect.top) * scaleY)
        ))
    };
}

function updateCropFields(crop) {
    const inputs = cropInputs();
    inputs.x.value = crop.x;
    inputs.y.value = crop.y;
    inputs.width.value = crop.width;
    inputs.height.value = crop.height;
}

export function initSpritesheetPreview() {
    const source = $("#sheetSource");
    const inputs = cropInputs();

    if (!source || Object.values(inputs).some(input => !input)) {
        console.warn("Éléments de sélection d'image introuvables dans index.html.");
        return;
    }

    source.addEventListener("change", () => {
        const asset = selectedAsset();
        if (!asset?.img?.naturalWidth) {
            state.selectedTileRegion = null;
        } else {
            const viewportWidth = $("#sheetPreview").parentElement.clientWidth - 4;
            sheetZoom = Math.min(1, viewportWidth / asset.img.naturalWidth);
            state.selectedTileRegion = clampCrop(asset, {
                x: 0,
                y: 0,
                width: Number(inputs.width.value) || 32,
                height: Number(inputs.height.value) || 32
            });
            updateCropFields(state.selectedTileRegion);
        }
        updateSheetPreview();
    });

    Object.values(inputs).forEach(input => {
        input.addEventListener("input", updateCropFromInputs);
        input.addEventListener("change", updateCropFromInputs);
    });

    $("#sheetZoomIn").addEventListener("click", () => {
        setSheetZoom(sheetZoom * 1.25);
    });
    $("#sheetZoomOut").addEventListener("click", () => {
        setSheetZoom(sheetZoom / 1.25);
    });
    $("#sheetZoomReset").addEventListener("click", () => {
        const asset = selectedAsset();
        const viewportWidth = $("#sheetPreview").parentElement.clientWidth - 4;
        sheetZoom = asset?.img?.naturalWidth
            ? Math.min(1, viewportWidth / asset.img.naturalWidth)
            : 1;
        updateSheetPreview();
    });

    updateSheetPreview();
}

function setSheetZoom(zoom) {
    const asset = selectedAsset();
    if (!asset?.img?.naturalWidth) return;

    sheetZoom = Math.max(0.1, Math.min(8, zoom));
    const longestSide = Math.max(
        asset.img.naturalWidth,
        asset.img.naturalHeight
    );
    sheetZoom = Math.min(sheetZoom, 4096 / longestSide);
    updateSheetPreview();
}

export function getSelectedSheetTile() {
    const selection = state.selectedTileRegion;
    const asset = selection && state.assets.find(
        item => item.id === selection.assetId
    );
    if (!asset?.img?.naturalWidth || !asset.img.naturalHeight) return null;

    const crop = clampCrop(asset, selection);
    if (
        crop.x !== selection.x ||
        crop.y !== selection.y ||
        crop.width !== selection.width ||
        crop.height !== selection.height
    ) return null;

    return { asset, ...crop };
}

export function selectSheetTile(assetId, region = null) {
    const asset = state.assets.find(item => item.id === assetId);
    if (!asset) return false;

    state.selectedTileAssetId = asset.id;
    const source = $("#sheetSource");
    if (source) source.value = asset.id;

    if (region && region.sourceWidth > 0 && region.sourceHeight > 0) {
        state.selectedTileRegion = {
            assetId: asset.id,
            x: region.sourceX,
            y: region.sourceY,
            width: region.sourceWidth,
            height: region.sourceHeight
        };
        const inputs = cropInputs();
        inputs.x.value = region.sourceX;
        inputs.y.value = region.sourceY;
        inputs.width.value = region.sourceWidth;
        inputs.height.value = region.sourceHeight;
    } else {
        state.selectedTileRegion = null;
    }

    updateSheetPreview();
    return true;
}

export function updateSheetPreview() {
    const source = $("#sheetSource");
    const preview = $("#sheetPreview");
    const info = $("#sheetPreviewInfo");
    const status = $("#sheetStatus");
    const tileButton = $("#useCropTileBtn");
    const objectButton = $("#placeCropObjectBtn");

    if (!source || !preview) return;

    const asset = selectedAsset();
    preview.replaceChildren();
    $("#sheetZoomValue").value = `${Math.round(sheetZoom * 100)} %`;
    $("#sheetZoomIn").disabled = !asset?.img?.naturalWidth;
    $("#sheetZoomOut").disabled = !asset?.img?.naturalWidth;
    $("#sheetZoomReset").disabled = !asset?.img?.naturalWidth;

    if (!asset?.img?.naturalWidth) {
        if (state.selectedTileRegion?.assetId !== source.value) {
            state.selectedTileRegion = null;
        }
        if (info) info.textContent = "Choisis une image pour sélectionner une zone.";
        if (status) status.textContent = "Trace une sélection sur l'image ou saisis ses coordonnées.";
        if (tileButton) tileButton.disabled = true;
        if (objectButton) objectButton.disabled = true;
        return;
    }

    const selection = state.selectedTileRegion?.assetId === asset.id
        ? clampCrop(asset, state.selectedTileRegion)
        : null;
    if (selection) {
        state.selectedTileRegion = selection;
        updateCropFields(selection);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "spritesheet-selection";

    const image = document.createElement("img");
    image.src = asset.dataUrl;
    image.alt = "Image source : cliquer-glisser pour sélectionner une zone";
    image.className = "spritesheet-image";
    image.draggable = false;
    image.style.width = `${asset.img.naturalWidth * sheetZoom}px`;
    image.style.height = `${asset.img.naturalHeight * sheetZoom}px`;
    image.addEventListener("load", () => {
        if (state.selectedTileRegion?.assetId === asset.id) {
            drawSelection(state.selectedTileRegion);
        }
    });
    wrapper.appendChild(image);

    const overlay = document.createElement("div");
    overlay.className = "spritesheet-grid crop-selection-overlay";
    overlay.style.width = `${asset.img.naturalWidth * sheetZoom}px`;
    overlay.style.height = `${asset.img.naturalHeight * sheetZoom}px`;

    const selectionBox = document.createElement("div");
    selectionBox.className = "crop-selection-box";
    overlay.appendChild(selectionBox);
    wrapper.appendChild(overlay);
    preview.appendChild(wrapper);

    let anchor = null;
    let dragging = false;

    function drawSelection(crop) {
        const bounds = image.getBoundingClientRect();
        const wrapperBounds = wrapper.getBoundingClientRect();
        const scaleX = bounds.width / image.naturalWidth;
        const scaleY = bounds.height / image.naturalHeight;
        selectionBox.style.left = `${bounds.left - wrapperBounds.left + crop.x * scaleX}px`;
        selectionBox.style.top = `${bounds.top - wrapperBounds.top + crop.y * scaleY}px`;
        selectionBox.style.width = `${crop.width * scaleX}px`;
        selectionBox.style.height = `${crop.height * scaleY}px`;
        selectionBox.hidden = false;
    }

    function commitDrag(event) {
        if (!dragging || !anchor) return;
        dragging = false;
        const point = setCropFromPointer(event, image);
        const crop = clampCrop(asset, {
            x: Math.min(anchor.x, point.x),
            y: Math.min(anchor.y, point.y),
            width: Math.abs(point.x - anchor.x),
            height: Math.abs(point.y - anchor.y)
        });
        state.selectedTileRegion = crop;
        updateCropFields(crop);
        updateSheetPreview();
    }

    overlay.addEventListener("pointerdown", event => {
        event.preventDefault();
        const point = setCropFromPointer(event, image);
        anchor = point;
        dragging = true;
        overlay.setPointerCapture(event.pointerId);
        drawSelection({
            x: point.x,
            y: point.y,
            width: 1,
            height: 1
        });
    });

    overlay.addEventListener("pointermove", event => {
        if (!dragging || !anchor) return;
        const point = setCropFromPointer(event, image);
        const crop = clampCrop(asset, {
            x: Math.min(anchor.x, point.x),
            y: Math.min(anchor.y, point.y),
            width: Math.max(1, Math.abs(point.x - anchor.x)),
            height: Math.max(1, Math.abs(point.y - anchor.y))
        });
        drawSelection(crop);
    });

    overlay.addEventListener("pointerup", commitDrag);
    overlay.addEventListener("pointercancel", commitDrag);

    if (selection) drawSelection(selection);

    const validSelection = Boolean(selection);
    if (tileButton) tileButton.disabled = !validSelection;
    if (objectButton) objectButton.disabled = !validSelection;

    if (info) {
        info.textContent = validSelection
            ? `${asset.img.naturalWidth} × ${asset.img.naturalHeight} px · ` +
              `Zone : X ${selection.x}, Y ${selection.y}, ` +
              `${selection.width} × ${selection.height} px. ` +
              "Fais glisser pour redessiner la zone."
            : `${asset.img.naturalWidth} × ${asset.img.naturalHeight} px · ` +
              "Fais glisser sur l'image pour sélectionner une zone.";
    }

    if (status) {
        status.textContent = validSelection
            ? "Choisis « Utiliser comme tuile » ou « Placer comme objet »."
            : "Trace une zone à la souris ou saisis X, Y, largeur et hauteur.";
    }
}
