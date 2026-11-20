"use strict";

const viewport = document.getElementById("viewport");
const scene = document.getElementById("scene");
const directory = document.getElementById("directory");
const directoryToggle = document.getElementById("directory-toggle");
const compactLayout = matchMedia("(max-width: 640px)");
const inspector = document.getElementById("inspector");
const stateSelect = document.getElementById("state-select");
const elementSelect = document.getElementById("element-select");
const frameSummary = document.getElementById("frame-summary");
const details = document.getElementById("selection-details");
const locationActions = document.getElementById("location-actions");
const copyStatus = document.getElementById("copy-status");
const zoomReset = document.getElementById("zoom-reset");
const modeButtons = document.querySelectorAll("[data-mode][aria-pressed]");
const frames = [];
const camera = { x: 0, y: 0, scale: 1 };
const selectionBox = Object.assign(document.createElement("div"), {
  className: "selection-box",
  hidden: true,
});

let activeFrame;
let activeElement;
let frameElements = [];
let drag;

function applyCamera() {
  scene.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  const percent = Math.round(camera.scale * 100);
  zoomReset.textContent = `${percent}%`;
  zoomReset.setAttribute("aria-label", `当前 ${percent}%，恢复到 100%`);
}

function fitItem(item) {
  const canvasWidth = viewport.clientWidth;
  const canvasHeight = viewport.clientHeight;
  const width = item.offsetWidth;
  const height = item.offsetHeight;
  const itemBounds = item.getBoundingClientRect();
  const sceneBounds = scene.getBoundingClientRect();
  const x = (itemBounds.left - sceneBounds.left) / camera.scale;
  const y = (itemBounds.top - sceneBounds.top) / camera.scale;
  const padding = 32;
  camera.scale = Math.max(0.01, Math.min(1, (canvasWidth - padding * 2) / width, (canvasHeight - padding * 2) / height));
  camera.x = (canvasWidth - width * camera.scale) / 2 - x * camera.scale;
  camera.y = (canvasHeight - height * camera.scale) / 2 - y * camera.scale;
  applyCamera();
}

function fitCanvas() {
  if (frames.length) fitItem(scene);
}

function setDirectoryOpen(open) {
  directory.hidden = !open;
  directoryToggle.setAttribute("aria-expanded", String(open));
}

function activateFrame(frame) {
  if (activeFrame === frame) return;
  activeFrame?.directoryButton.removeAttribute("aria-current");
  frame.directoryButton.setAttribute("aria-current", "true");
  activeFrame = frame;
}

function jumpToFrame(frame) {
  if (compactLayout.matches) {
    setDirectoryOpen(false);
    directoryToggle.focus();
  }
  if (!inspector.hidden) {
    refreshInspector(frame, frame === activeFrame ? activeElement : null);
  } else if (frame !== activeFrame) {
    activateFrame(frame);
    activeElement = null;
  }
  fitItem(frame.figure);
}

function zoomTo(scale, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  if (!frames.length) return;
  const next = Math.min(3, Math.max(0.01, scale));
  const ratio = next / camera.scale;
  camera.x = x - (x - camera.x) * ratio;
  camera.y = y - (y - camera.y) * ratio;
  camera.scale = next;
  applyCamera();
}

function setMode(mode) {
  viewport.dataset.mode = mode;
  for (const button of modeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  for (const frame of frames) frame.iframe.tabIndex = mode === "interact" ? 0 : -1;
  inspector.hidden = mode !== "inspect";
  if (mode === "inspect" && frames.length) refreshInspector(activeFrame || frames[0], activeElement);
  drawSelection();
}

function* pageElements(element) {
  yield element;
  for (const child of element.children) yield* pageElements(child);
  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) yield* pageElements(child);
  }
}

function frameDocument(frame) {
  if (!frame.loaded) return null;
  const doc = frame.iframe.contentDocument;
  return doc && doc.body && doc.URL !== "about:blank" ? doc : null;
}

function refreshInspector(frame, element) {
  activateFrame(frame);
  stateSelect.value = String(frame.index);
  const doc = frameDocument(frame);
  frameElements = doc ? [doc.documentElement, ...pageElements(doc.body)] : [];

  const seenIds = new Set();
  const duplicateIds = new Set();
  let missingIds = 0;
  for (const node of frameElements) {
    if (!node.id.trim()) {
      missingIds++;
    } else if (seenIds.has(node.id)) {
      duplicateIds.add(node.id);
    } else {
      seenIds.add(node.id);
    }
  }

  elementSelect.replaceChildren(new Option("选择元素…", ""));
  for (const [index, node] of frameElements.entries()) {
    const id = node.id.trim() ? node.id : "缺少 ID";
    elementSelect.add(new Option(`${id} · <${node.localName}>`, String(index)));
  }
  elementSelect.disabled = !doc;
  if (!doc) {
    frameSummary.textContent = frame.loaded ? "无法检查页面，请确认入口可访问且与画布同源。" : "正在加载页面…";
    frameSummary.dataset.issue = String(frame.loaded);
  } else {
    const { innerWidth, innerHeight } = doc.defaultView;
    const issues = [];
    if (innerWidth !== frame.width || innerHeight !== frame.height) {
      issues.push(`${innerWidth} × ${innerHeight}（应为 ${frame.width} × ${frame.height}）`);
    }
    if (missingIds || duplicateIds.size) {
      issues.push(`缺少 ${missingIds} 个 ID，重复 ${duplicateIds.size} 个 ID`);
    }
    frameSummary.textContent = issues.join(" · ");
    frameSummary.dataset.issue = String(issues.length > 0);
  }
  frameSummary.hidden = !frameSummary.textContent;
  showElement(frameElements.includes(element) ? element : null);
}

function showElement(element) {
  activeElement = element;
  details.hidden = !element;
  locationActions.hidden = !element?.id.trim();
  copyStatus.textContent = "";
  elementSelect.value = element ? String(frameElements.indexOf(element)) : "";
  if (element) {
    document.getElementById("selected-id").textContent = element.id.trim() ? element.id : "缺少 ID";
    document.getElementById("selected-tag").textContent = `<${element.localName}>`;
  }
  drawSelection();
}

async function copyLocation() {
  const element = activeElement;
  if (!element?.isConnected || !element.id.trim()) return;
  const { groupName, stateName } = activeFrame;
  const text = ["页面名：" + groupName, "状态名：" + stateName, "元素 ID：" + element.id].join("\n");
  let status;
  try {
    await navigator.clipboard.writeText(text);
    status = "已复制";
  } catch {
    status = "复制失败，请检查浏览器的剪贴板权限。";
  }
  if (activeElement === element) copyStatus.textContent = status;
}

function drawSelection() {
  selectionBox.hidden = true;
  if (inspector.hidden || !activeElement?.isConnected) return;
  const rect = activeElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  activeFrame.selectionLayer.append(selectionBox);
  Object.assign(selectionBox.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  selectionBox.hidden = false;
}

function elementAtPoint(root, x, y) {
  let element = root.elementFromPoint(x, y);
  while (element?.shadowRoot?.elementFromPoint) {
    const child = element.shadowRoot.elementFromPoint(x, y);
    if (!child || child === element) break;
    element = child;
  }
  return element;
}

function createFrame(groupName, state, size) {
  const figure = document.createElement("figure");
  figure.className = "state";
  figure.style.width = size.width + "px";
  const screen = document.createElement("div");
  screen.className = "screen";
  const iframe = document.createElement("iframe");
  iframe.title = `${groupName} / ${state.name}`;
  iframe.width = size.width;
  iframe.height = size.height;
  iframe.tabIndex = -1;

  const selectionLayer = document.createElement("div");
  selectionLayer.className = "selection-layer";
  selectionLayer.setAttribute("aria-hidden", "true");
  const hitLayer = document.createElement("div");
  hitLayer.className = "hit-layer";
  hitLayer.setAttribute("aria-hidden", "true");

  const caption = document.createElement("figcaption");
  const name = document.createElement("span");
  name.textContent = state.name;
  const dimensions = document.createElement("span");
  dimensions.className = "dimensions";
  dimensions.textContent = `${size.width} × ${size.height}`;
  caption.append(name, dimensions);

  const directoryButton = document.createElement("button");
  directoryButton.type = "button";
  directoryButton.textContent = state.name;
  const frame = {
    ...size, figure, iframe, selectionLayer, directoryButton, groupName, stateName: state.name,
    index: frames.length, loaded: false,
  };
  directoryButton.addEventListener("click", () => jumpToFrame(frame));
  frames.push(frame);
  stateSelect.add(new Option(iframe.title, String(frame.index)));

  iframe.addEventListener("load", () => {
    frame.loaded = true;
    const doc = frameDocument(frame);
    doc?.addEventListener("scroll", drawSelection, { capture: true, passive: true });
    if (!inspector.hidden && frame === activeFrame) refreshInspector(frame);
  });
  hitLayer.addEventListener("click", event => {
    if (viewport.dataset.mode !== "inspect") return;
    const doc = frameDocument(frame);
    const bounds = iframe.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * frame.width / bounds.width;
    const y = (event.clientY - bounds.top) * frame.height / bounds.height;
    refreshInspector(frame, doc ? elementAtPoint(doc, x, y) : null);
  });

  iframe.src = state.src;
  screen.append(iframe, selectionLayer, hitLayer);
  figure.append(screen, caption);
  return frame;
}

function validLabel(label) {
  return typeof label === "string" && label.trim().length > 0;
}

function parseBoard(data) {
  if (!Array.isArray(data?.groups) || !data.groups.length) throw new Error("board.json 中需要至少一个页面分组。");
  const groups = data.groups.map((group, index) => {
    const { name, viewport: size, states } = group || {};
    if (!validLabel(name) || ![size?.width, size?.height].every(value => Number.isSafeInteger(value) && value > 0)
        || !Array.isArray(states) || !states.length) {
      throw new Error(`第 ${index + 1} 个分组需要名称、正整数视口宽高和至少一个状态。`);
    }
    return {
      name,
      size: { width: size.width, height: size.height },
      states: states.map(state => {
        if (!validLabel(state?.name) || !validLabel(state?.src)) throw new Error(`「${name}」中的每个状态都需要名称和页面入口。`);
        const src = new URL(state.src, location.href);
        if (src.origin !== location.origin || !["http:", "https:"].includes(src.protocol)) {
          throw new Error(`「${state.name}」的页面入口需要与画布同源。`);
        }
        return { name: state.name, src: src.href };
      }),
    };
  });
  let prototypeSrc;
  if (data.prototypeSrc !== undefined) {
    if (!validLabel(data.prototypeSrc)) throw new Error("prototypeSrc 需要填写原型页面的地址。");
    const url = new URL(data.prototypeSrc, location.href);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("原型入口需要使用 HTTP 或 HTTPS 地址。");
    prototypeSrc = url.href;
  }
  return { title: validLabel(data.title) ? data.title : "UI 状态画布", groups, prototypeSrc };
}

async function loadBoard() {
  const message = document.getElementById("board-message");
  try {
    if (location.protocol === "file:") throw new Error("请通过本地服务器打开画布，例如在项目目录运行 python3 -m http.server 1104 --bind 127.0.0.1。");
    const response = await fetch("./board.json");
    if (!response.ok) throw new Error(`无法读取 board.json（HTTP ${response.status}）。`);
    const board = parseBoard(await response.json());
    document.title = board.title;
    document.getElementById("board-title").textContent = board.title;
    if (board.prototypeSrc) {
      const prototypeLink = document.getElementById("prototype-link");
      prototypeLink.href = board.prototypeSrc;
      prototypeLink.hidden = false;
    }
    const directoryGroups = document.getElementById("directory-groups");
    for (const group of board.groups) {
      const directoryGroup = document.createElement("section");
      directoryGroup.className = "directory-group";
      const directoryTitle = document.createElement("h3");
      directoryTitle.textContent = group.name;
      directoryGroup.append(directoryTitle);
      const section = document.createElement("section");
      section.className = "group";
      const title = document.createElement("h2");
      title.textContent = group.name;
      const states = document.createElement("div");
      states.className = "states";
      // Cap row length while leaving each frame at its configured width.
      states.style.gridTemplateColumns = `repeat(${Math.min(4, group.states.length)}, max-content)`;
      for (const state of group.states) {
        const frame = createFrame(group.name, state, group.size);
        states.append(frame.figure);
        directoryGroup.append(frame.directoryButton);
      }
      section.append(title, states);
      scene.append(section);
      directoryGroups.append(directoryGroup);
    }
    activateFrame(frames[0]);
    fitCanvas();
    setMode(viewport.dataset.mode);
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  }
}

setDirectoryOpen(!compactLayout.matches);
compactLayout.addEventListener("change", event => setDirectoryOpen(!event.matches));
directoryToggle.addEventListener("click", () => setDirectoryOpen(directory.hidden));
for (const button of modeButtons) button.addEventListener("click", () => setMode(button.dataset.mode));
document.getElementById("zoom-out").addEventListener("click", () => zoomTo(camera.scale / 1.25));
document.getElementById("zoom-in").addEventListener("click", () => zoomTo(camera.scale * 1.25));
document.getElementById("zoom-fit").addEventListener("click", fitCanvas);
zoomReset.addEventListener("click", () => zoomTo(1));
document.getElementById("copy-location").addEventListener("click", copyLocation);
stateSelect.addEventListener("change", () => refreshInspector(frames[Number(stateSelect.value)]));
elementSelect.addEventListener("change", () => showElement(elementSelect.value ? frameElements[Number(elementSelect.value)] : null));

viewport.addEventListener("wheel", event => {
  event.preventDefault();
  const bounds = viewport.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) {
    zoomTo(camera.scale * Math.exp(-event.deltaY * 0.01), event.clientX - bounds.left, event.clientY - bounds.top);
  } else {
    const step = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    camera.x -= event.deltaX * step;
    camera.y -= event.deltaY * step;
    applyCamera();
  }
}, { passive: false });

viewport.addEventListener("pointerdown", event => {
  if (event.button !== 0 || drag || event.target.closest(".board-message")) return;
  if (viewport.dataset.mode === "inspect" && event.target.closest(".hit-layer")) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("is-dragging");
});

viewport.addEventListener("pointermove", event => {
  if (drag?.id !== event.pointerId) return;
  camera.x = drag.cameraX + event.clientX - drag.x;
  camera.y = drag.cameraY + event.clientY - drag.y;
  applyCamera();
});

viewport.addEventListener("lostpointercapture", event => {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  viewport.classList.remove("is-dragging");
});

loadBoard();