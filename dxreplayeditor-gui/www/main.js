Neutralino.init();

Neutralino.events.on("ready", async () => {
  try {
    const displays = await Neutralino.computer.getDisplays();
    if (displays.length > 0) {
      const primaryDisplay = displays[0];
      const scalingFactor = primaryDisplay.dpi / 96; // Standard DPI is 96
      if (scalingFactor > 1) {
        const newWidth = Math.round(800 * scalingFactor);
        const newHeight = Math.round(1000 * scalingFactor);
        await Neutralino.window.setSize({
          width: newWidth,
          height: newHeight,
        });
      }
    }
  } catch (err) {
    console.error("Error getting display info:", err);
  }
  protobuf.util.Long = Long;
  protobuf.configure();

  let root;
  let BattleLogFile;
  try {
    root = await protobuf.load("gdxsv.proto");
    BattleLogFile = root.lookupType("proto.BattleLogFile");
  } catch (err) {
    Neutralino.os.showMessageBox(
      "Error",
      `Failed to load protobuf: ${err.message}`
    );
    return;
  }

  let arrowsWidth, arrowsHeight, buttonsWidth, buttonsHeight;

  async function loadImages() {
    const arrowsImg = new Image();
    arrowsImg.src = "ARROWS.png";
    await new Promise((resolve) => (arrowsImg.onload = resolve));
    arrowsWidth = arrowsImg.width;
    arrowsHeight = arrowsImg.height;

    const buttonsImg = new Image();
    buttonsImg.src = "BUTTONS.png";
    await new Promise((resolve) => (buttonsImg.onload = resolve));
    buttonsWidth = buttonsImg.width;
    buttonsHeight = buttonsImg.height;
  }

  await loadImages();

  const KEY_CODES = {
    "↑": 0x0020,
    "↓": 0x0010,
    "←": 0x0008,
    "→": 0x0004,
    A: 0x4000,
    B: 0x2000,
    X: 0x0002,
    Y: 0x0001,
    R: 0x1000,
    L: 0x8000,
    S: 0x0080,
  };

  const KEY_NAME_TO_VALUE = new Map(Object.entries(KEY_CODES));

  function getInputButtonNames(input) {
    const names = [];
    const up = (input & KEY_CODES["↑"]) !== 0;
    const down = (input & KEY_CODES["↓"]) !== 0;
    const left = (input & KEY_CODES["←"]) !== 0;
    const right = (input & KEY_CODES["→"]) !== 0;

    if (up && left) names.push("↖");
    else if (up && right) names.push("↗");
    else if (down && left) names.push("↙");
    else if (down && right) names.push("↘");
    else if (up) names.push("↑");
    else if (down) names.push("↓");
    else if (left) names.push("←");
    else if (right) names.push("→");

    const actionButtons = ["A", "B", "X", "Y", "R", "L", "S"];
    for (const name of actionButtons) {
      if ((input & KEY_CODES[name]) !== 0) {
        names.push(name);
      }
    }
    return names.join(" ");
  }

  let battleLogObject = null;
  let rounds = [];
  let selectedRoundIndex = -1;
  let editedFrames = [];
  let gameStartFrames = {};
  let isEditing = false;

  function getGroupedFrames(p, round) {
    const groups = [];
    if (!battleLogObject.inputs || battleLogObject.inputs.length === 0) {
      return groups;
    }

    let startGroupFrame = round.start;
    let lastPlayerInput = Number(
      (BigInt(battleLogObject.inputs[round.start]) >> BigInt(p * 16)) & 0xffffn
    );

    for (let i = round.start + 1; i <= round.end; i++) {
      const currentPlayerInput = Number(
        (BigInt(battleLogObject.inputs[i]) >> BigInt(p * 16)) & 0xffffn
      );
      if (currentPlayerInput !== lastPlayerInput) {
        const endGroupFrame = i - 1;
        groups.push({
          start: startGroupFrame,
          end: endGroupFrame,
          input: lastPlayerInput,
        });
        startGroupFrame = i;
        lastPlayerInput = currentPlayerInput;
      }
    }

    groups.push({
      start: startGroupFrame,
      end: round.end,
      input: lastPlayerInput,
    });

    return groups;
  }

  async function loadFile(filePath) {
    try {
      const buffer = await Neutralino.filesystem.readBinaryFile(filePath);
      battleLogObject = BattleLogFile.decode(new Uint8Array(buffer));
      rounds = [];
      const { startMsgIndexes, inputs } = battleLogObject;
      if (startMsgIndexes && startMsgIndexes.length > 0) {
        for (let i = 0; i < startMsgIndexes.length; i++) {
          const start = startMsgIndexes[i];
          const end =
            i + 1 < startMsgIndexes.length
              ? startMsgIndexes[i + 1] - 1
              : inputs.length - 1;
          rounds.push({ start, end });
        }
      } else {
        rounds.push({ start: 0, end: inputs.length - 1 });
      }
      return rounds;
    } catch (err) {
      Neutralino.os.showMessageBox(
        "Error",
        `Error loading file: ${err.message}`
      );
      return null;
    }
  }

  function modifyFrames(
    startFrame,
    endFrame,
    key,
    action,
    playerIndex,
    roundIndex
  ) {
    if (!KEY_NAME_TO_VALUE.has(key.toUpperCase())) {
      Neutralino.os.showMessageBox("Error", "Invalid key.");
      return;
    }

    const keyCode = KEY_NAME_TO_VALUE.get(key.toUpperCase());
    const p = playerIndex - 1;

    for (let i = startFrame; i <= endFrame; i++) {
      if (i >= battleLogObject.inputs.length) continue;

      let frameInput = BigInt(battleLogObject.inputs[i]);
      let playerInput = Number((frameInput >> BigInt(p * 16)) & 0xffffn);

      if (action === "add") {
        playerInput |= keyCode;
      } else if (action === "remove") {
        playerInput &= ~keyCode;
      }

      const clearPlayerMask = ~(0xffffn << BigInt(p * 16));
      frameInput &= clearPlayerMask;

      const newPlayerInputBigInt = BigInt(playerInput) << BigInt(p * 16);
      frameInput |= newPlayerInputBigInt;

      battleLogObject.inputs[i] = frameInput.toString();
    }
  }

  async function saveFile(newFilename) {
    try {
      const newBuffer = BattleLogFile.encode(battleLogObject).finish();
      await Neutralino.filesystem.writeBinaryFile(newFilename, newBuffer);
      Neutralino.os.showMessageBox("Success", "File saved successfully!");
    } catch (err) {
      Neutralino.os.showMessageBox(
        "Error",
        `Error saving file: ${err.message}`
      );
    }
  }

  const loadFileBtn = document.getElementById("loadFile");
  const playerSelect = document.getElementById("playerSelect");
  const saveFileBtn = document.getElementById("saveFile");
  const replayBtn = document.getElementById("replay");
  const roundList = document.getElementById("roundList");
  const frameData = document.getElementById("frameData");
  const frameRangeInput = document.getElementById("frameRange");
  const keyInput = document.getElementById("key");
  const addKeyBtn = document.getElementById("addKey");
  const removeKeyBtn = document.getElementById("removeKey");
  const battleIdInput = document.getElementById("battleId");
  const loadFromUrlBtn = document.getElementById("loadFromUrl");
  const markGameStartBtn = document.getElementById("markGameStart");

  markGameStartBtn.addEventListener("click", () => {
    const [startFrameStr] = frameRangeInput.value.split("-");
    const startFrame = parseInt(startFrameStr, 10);
    if (!isNaN(startFrame)) {
      gameStartFrames[selectedRoundIndex] = startFrame;
      renderFrames(true);
    }
  });

  async function updateUiWithLoadedFile(filePath, loadedRounds) {
    rounds = loadedRounds;
    isEditing = false;

    // Populate replay info
    document.getElementById("replayInfo").style.display = "block";
    document.getElementById("playerSelect").style.display = "block";
    document.getElementById("main").style.display = "flex";
    document.getElementById("edit").style.display = "block";
    saveFileBtn.disabled = true;
    replayBtn.disabled = true;
    markGameStartBtn.disabled = true;
    editedFrames = [];
    gameStartFrames = {};
    document.getElementById("battleCode").textContent =
      battleLogObject.battleCode || "N/A";

    const defaultNumPlayers = 2;
    const numPlayers =
      battleLogObject.users && battleLogObject.users.length > 0
        ? battleLogObject.users.length
        : defaultNumPlayers;
    document.getElementById("numPlayers").textContent = numPlayers;

    let startTime = "N/A";
    let startMs = 0;
    if (battleLogObject.start_at) {
      startMs = battleLogObject.start_at.toNumber();
      startTime = new Date(startMs).toLocaleString();
    } else {
      const match = filePath.match(/(\d+)\.pb$/);
      if (match) {
        startMs = Number(match[1]);
        startTime = new Date(startMs).toLocaleString();
      }
    }
    document.getElementById("startAt").textContent = startTime;

    let endTime = "N/A";
    if (battleLogObject.end_at) {
      endTime = new Date(battleLogObject.end_at.toNumber()).toLocaleString();
    } else if (
      battleLogObject.inputs &&
      battleLogObject.inputs.length > 0 &&
      startMs > 0
    ) {
      const durationMs = (battleLogObject.inputs.length / 60) * 1000;
      endTime = new Date(startMs + durationMs).toLocaleString();
    }
    document.getElementById("endAt").textContent = endTime;

    // Populate player select
    playerSelect.innerHTML = "";
    if (battleLogObject.users && battleLogObject.users.length > 0) {
      battleLogObject.users.forEach((user) => {
        const option = document.createElement("option");
        option.value = user.pos;
        option.textContent = `ID: ${user.userId || "N/A"}, HN: ${
          user.userName || "N/A"
        }, PN: ${user.pilotName || "N/A"}`;
        playerSelect.appendChild(option);
      });
    } else {
      for (let pos = 1; pos <= defaultNumPlayers; pos++) {
        const option = document.createElement("option");
        option.value = pos;
        option.textContent = `ID: N/A, HN: N/A, PN: N/A`;
        playerSelect.appendChild(option);
      }
    }

    // Select the first player and render first round if available
    if (playerSelect.options.length > 0 && rounds.length > 0) {
      playerSelect.value = playerSelect.options[0].value;
      selectedRoundIndex = 0;
      renderFrames();
    }

    renderRounds();
  }

  loadFileBtn.addEventListener("click", async () => {
    let entry = await Neutralino.os.showOpenDialog("Open a replay file", {
      filters: [{ name: "Replay Files", extensions: ["pb"] }],
    });

    if (entry.length > 0) {
      const loadedRounds = await loadFile(entry[0]);
      if (loadedRounds) {
        await updateUiWithLoadedFile(entry[0], loadedRounds);
      }
    }
  });

  loadFromUrlBtn.addEventListener("click", async () => {
    const battleId = battleIdInput.value;
    if (!battleId) {
      Neutralino.os.showMessageBox("Error", "Please enter a Battle ID.");
      return;
    }

    const url = `https://storage.googleapis.com/gdxsv/replays/${battleId}.pb`;
    const tempDir = await Neutralino.os.getPath("temp");
    const tempFile = `${tempDir}/${battleId}.pb`;

    let downloadCommand = "";
    if (NL_OS === "Windows") {
      downloadCommand = `powershell -command "Invoke-WebRequest -Uri ${url} -OutFile ${tempFile}"`;
    } else {
      downloadCommand = `curl -L -o "${tempFile}" "${url}"`;
    }

    try {
      await Neutralino.os.execCommand(downloadCommand);
      const loadedRounds = await loadFile(tempFile);
      if (loadedRounds) {
        await updateUiWithLoadedFile(tempFile, loadedRounds);
      }
    } catch (err) {
      Neutralino.os.showMessageBox(
        "Error",
        `Failed to download or load file: ${err.message}`
      );
    }
  });

  function renderRounds() {
    roundList.innerHTML = "";
    rounds.forEach((round, index) => {
      const li = document.createElement("li");
      li.textContent = `Round ${index + 1} (${round.start}-${round.end})`;
      if (index === selectedRoundIndex) {
        li.classList.add("highlighted");
      }

      if (isEditing && index !== selectedRoundIndex) {
        li.classList.add("locked");
      } else {
        li.addEventListener("click", () => {
          if (isEditing) return;
          selectedRoundIndex = index;
          frameRangeInput.value = "0-0";
          renderFrames();
          renderRounds();
        });
      }
      roundList.appendChild(li);
    });
  }

  function getArrowsUV(code) {
    let uv0 = { x: 1 / 3, y: 1 / 3 };
    let uv1 = { x: 2 / 3, y: 2 / 3 };

    if (code & KEY_CODES["↑"]) {
      if (code & KEY_CODES["←"]) {
        uv0 = { x: 0 / 3, y: 0 / 3 };
        uv1 = { x: 1 / 3, y: 1 / 3 };
      } else if (code & KEY_CODES["→"]) {
        uv0 = { x: 2 / 3, y: 0 / 3 };
        uv1 = { x: 3 / 3, y: 1 / 3 };
      } else {
        uv0 = { x: 1 / 3, y: 0 / 3 };
        uv1 = { x: 2 / 3, y: 1 / 3 };
      }
    } else if (code & KEY_CODES["↓"]) {
      if (code & KEY_CODES["←"]) {
        uv0 = { x: 0 / 3, y: 2 / 3 };
        uv1 = { x: 1 / 3, y: 3 / 3 };
      } else if (code & KEY_CODES["→"]) {
        uv0 = { x: 2 / 3, y: 2 / 3 };
        uv1 = { x: 3 / 3, y: 3 / 3 };
      } else {
        uv0 = { x: 1 / 3, y: 2 / 3 };
        uv1 = { x: 2 / 3, y: 3 / 3 };
      }
    } else if (code & KEY_CODES["←"]) {
      uv0 = { x: 0 / 3, y: 1 / 3 };
      uv1 = { x: 1 / 3, y: 2 / 3 };
    } else if (code & KEY_CODES["→"]) {
      uv0 = { x: 2 / 3, y: 1 / 3 };
      uv1 = { x: 3 / 3, y: 2 / 3 };
    }

    return { uv0, uv1 };
  }

  function getButtonUV(name) {
    const index = {
      A: 0,
      B: 1,
      X: 2,
      Y: 3,
      R: 4,
      L: 5,
      S: 6,
    }[name];
    const uv0 = { x: index / 7, y: 0 };
    const uv1 = { x: (index + 1) / 7, y: 1 };
    return { uv0, uv1 };
  }

  function createSpriteImage(src, fullW, fullH, uv0, uv1) {
    const buttonSize = 20;
    const naturalSliceW = (uv1.x - uv0.x) * fullW;
    const naturalSliceH = (uv1.y - uv0.y) * fullH;
    const scale = buttonSize / naturalSliceW;

    const displayW = buttonSize;
    const displayH = naturalSliceH * scale;

    const div = document.createElement("div");
    div.style.display = "inline-block";
    div.style.width = `${displayW}px`;
    div.style.height = `${displayH}px`;
    div.style.overflow = "hidden";
    div.style.verticalAlign = "middle";

    const img = document.createElement("img");
    img.src = src;
    img.style.width = `${fullW * scale}px`;
    img.style.height = `${fullH * scale}px`;
    img.style.position = "relative";
    img.style.left = `-${uv0.x * fullW * scale}px`;
    img.style.top = `-${uv0.y * fullH * scale}px`;

    div.appendChild(img);
    return div;
  }

  function renderFrames(preserveScroll = false) {
    if (selectedRoundIndex === -1) return;

    const playerIndex = parseInt(playerSelect.value, 10);
    const frames = getGroupedFrames(
      playerIndex - 1,
      rounds[selectedRoundIndex]
    ).reverse();

    let currentScroll = 0;
    if (preserveScroll) {
      currentScroll = frameData.scrollTop;
    }
    frameData.innerHTML = "";
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.tableLayout = "fixed";

    frames.forEach((group) => {
      const frameCount = group.end - group.start + 1;
      const frameRange = `${group.start}~${group.end}`;

      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.dataset.start = group.start;
      tr.dataset.end = group.end;
      tr.addEventListener("click", () => {
        frameRangeInput.value = `${group.start}-${group.end}`;
        updateHighlights();
      });

      const frameTd = document.createElement("td");
      frameTd.textContent = `Frame ${frameRange}`;
      if (gameStartFrames[selectedRoundIndex] === group.start) {
        frameTd.textContent +=
          "                                   (Game Start)";
        frameTd.classList.add("game-start");
      }
      frameTd.style.fontFamily = "monospace";
      frameTd.style.whiteSpace = "pre";
      frameTd.style.padding = "1px";
      frameTd.style.width = "20ch";
      tr.appendChild(frameTd);

      const countTd = document.createElement("td");
      countTd.textContent = `[${frameCount.toString().padStart(2, "0")}] `;
      countTd.style.fontFamily = "monospace";
      countTd.style.textAlign = "right";
      countTd.style.whiteSpace = "pre";
      countTd.style.padding = "1px";
      countTd.style.width = "5ch";
      tr.appendChild(countTd);

      const inputsTd = document.createElement("td");
      inputsTd.style.padding = "1px";

      // Add arrow
      const direction =
        group.input &
        (KEY_CODES["↑"] | KEY_CODES["↓"] | KEY_CODES["←"] | KEY_CODES["→"]);
      const arrowUV = getArrowsUV(direction);
      inputsTd.appendChild(
        createSpriteImage(
          "ARROWS.png",
          arrowsWidth,
          arrowsHeight,
          arrowUV.uv0,
          arrowUV.uv1
        )
      );

      // Add buttons
      const actionButtons = ["A", "B", "X", "Y", "R", "L", "S"];
      actionButtons.forEach((name) => {
        if (group.input & KEY_CODES[name]) {
          const buttonUV = getButtonUV(name);
          inputsTd.appendChild(
            createSpriteImage(
              "BUTTONS.png",
              buttonsWidth,
              buttonsHeight,
              buttonUV.uv0,
              buttonUV.uv1
            )
          );
        }
      });

      tr.appendChild(inputsTd);
      table.appendChild(tr);
    });
    frameData.appendChild(table);
    updateHighlights();

    const highlightedRow = frameData.querySelector("tr.highlighted");
    if (highlightedRow) {
      highlightedRow.scrollIntoView({ block: "center", behavior: "instant" });
    } else if (preserveScroll) {
      frameData.scrollTop = currentScroll;
    } else {
      frameData.scrollTop = frameData.scrollHeight;
    }

    const rows = frameData.querySelectorAll("tr");
    rows.forEach((row) => {
      const groupStart = parseInt(row.dataset.start, 10);
      const groupEnd = parseInt(row.dataset.end, 10);
      for (const range of editedFrames) {
        if (
          range.roundIndex === selectedRoundIndex &&
          range.playerIndex === playerIndex &&
          groupEnd >= range.start &&
          groupStart <= range.end
        ) {
          row.classList.add("edited");
          break;
        }
      }
    });
  }

  function updateHighlights() {
    const value = frameRangeInput.value;
    if (!value.includes("-") || value === "0-0") {
      replayBtn.disabled = true;
      markGameStartBtn.disabled = true;
      return;
    }
    const [startStr, endStr] = value.split("-");
    const inputStart = parseInt(startStr, 10);
    const inputEnd = parseInt(endStr, 10);
    if (isNaN(inputStart) || isNaN(inputEnd)) {
      replayBtn.disabled = true;
      markGameStartBtn.disabled = true;
      return;
    }

    replayBtn.disabled = false;
    markGameStartBtn.disabled = false;

    const lines = frameData.querySelectorAll("tr");
    lines.forEach((line) => line.classList.remove("highlighted"));
    lines.forEach((line) => {
      const groupStart = parseInt(line.dataset.start, 10);
      const groupEnd = parseInt(line.dataset.end, 10);
      if (groupEnd >= inputStart && groupStart <= inputEnd) {
        line.classList.add("highlighted");
      }
    });
  }

  playerSelect.addEventListener("change", renderFrames);

  frameData.addEventListener("scroll", () => {
    const countdownSpan = document.getElementById("countdown");
    const gameStartFrame = gameStartFrames[selectedRoundIndex];
    if (gameStartFrame === undefined) {
      countdownSpan.textContent = "";
      return;
    }

    const containerRect = frameData.getBoundingClientRect();
    const rows = frameData.querySelectorAll("tr");
    let bottomVisibleFrame = -1;

    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const rowRect = row.getBoundingClientRect();
      if (rowRect.bottom <= containerRect.bottom) {
        bottomVisibleFrame = parseInt(row.dataset.start, 10);
        break;
      }
    }

    if (bottomVisibleFrame !== -1 && bottomVisibleFrame >= gameStartFrame) {
      const frameDifference = bottomVisibleFrame - gameStartFrame;
      const elapsedSeconds = frameDifference / 59.94;
      const remainingSeconds = 210 - elapsedSeconds;
      const seconds = Math.floor(remainingSeconds);
      const frames = Math.floor((remainingSeconds * 100) % 100);
      countdownSpan.textContent = `Time: ${seconds}' ${frames
        .toString()
        .padStart(2, "0")}"`;
    } else {
      countdownSpan.textContent = "";
    }
  });

  frameRangeInput.addEventListener("input", updateHighlights);

  addKeyBtn.addEventListener("click", () => handleModification("add"));
  removeKeyBtn.addEventListener("click", () => handleModification("remove"));

  const keyButtons = document.querySelectorAll(".key-btn");
  keyButtons.forEach((button) => {
    button.addEventListener("click", () => {
      keyInput.value = button.textContent;
    });
  });

  function handleModification(action) {
    if (selectedRoundIndex === -1) {
      Neutralino.os.showMessageBox("Error", "Please select a round first.");
      return;
    }

    const [startFrameStr, endFrameStr] = frameRangeInput.value.split("-");
    const startFrame = parseInt(startFrameStr, 10);
    const endFrame = parseInt(endFrameStr, 10);
    const key = keyInput.value;
    const playerIndex = parseInt(playerSelect.value, 10);

    if (isNaN(startFrame) || isNaN(endFrame) || !key) {
      Neutralino.os.showMessageBox("Error", "Invalid input for modification.");
      return;
    }

    modifyFrames(
      startFrame,
      endFrame,
      key,
      action,
      playerIndex,
      selectedRoundIndex
    );
    saveFileBtn.disabled = false;
    isEditing = true;
    editedFrames.push({
      start: startFrame,
      end: endFrame,
      playerIndex: playerIndex,
      roundIndex: selectedRoundIndex,
    });
    renderFrames(true);
    renderRounds();
    updateHighlights();
  }

  saveFileBtn.addEventListener("click", async () => {
    let entry = await Neutralino.os.showSaveDialog(
      "Save replay file (Type 'xxxx.pb')",
      {
        filters: [{ name: "Replay Files", extensions: ["pb"] }],
      }
    );

    if (entry) {
      await saveFile(entry);
    }
  });

  async function saveTempReplayFile() {
    try {
      const tempDir = await Neutralino.os.getPath("temp");
      const tempFilename = `replay-temp-${Date.now()}.pb`;
      const tempFilepath = `${tempDir}/${tempFilename}`;
      const newBuffer = BattleLogFile.encode(battleLogObject).finish();
      await Neutralino.filesystem.writeBinaryFile(tempFilepath, newBuffer);
      return tempFilepath;
    } catch (err) {
      Neutralino.os.showMessageBox(
        "Error",
        `Error saving temporary replay file: ${err.message}`
      );
      return null;
    }
  }

  replayBtn.addEventListener("click", async () => {
    const tempFilepath = await saveTempReplayFile();
    if (!tempFilepath) {
      return;
    }

    const targetRound = selectedRoundIndex + 1;
    const [startFrameStr] = frameRangeInput.value.split("-");
    const targetFrame = parseInt(startFrameStr, 10);
    const targetPOV = parseInt(playerSelect.value, 10);

    if (isNaN(targetFrame)) {
      Neutralino.os.showMessageBox("Error", "Invalid frame selection.");
      return;
    }

    const command =
      `open /Users/edwardli/Development/flycast/build/Release/Flycast.app --args ` +
      `"/Users/edwardli/Flycast/Mobile Suit Gundam - Federation vs. Zeon DX/Mobile Suit Gundam - Federation vs. Zeon DX.cue" ` +
      `-config gdxsv:replay="${tempFilepath}" ` +
      `-config gdxsv:replay_target_round=${targetRound} ` +
      `-config gdxsv:replay_target_frame=${targetFrame} ` +
      `-config gdxsv:ReplayPOV=${targetPOV}`;

    try {
      await Neutralino.os.execCommand(command);
    } catch (err) {
      Neutralino.os.showMessageBox(
        "Error",
        `Failed to launch Flycast: ${err.message}`
      );
    }
  });

  const menu = [
    {
      id: "file",
      text: "File",
      menuItems: [
        { id: "open", text: "Open", shortcut: "o" },
        { id: "save", text: "Save", shortcut: "s" },
        { text: "-" },
        { id: "quit", text: "Quit", shortcut: "q" },
      ],
    },
    {
      id: "edit",
      text: "Edit",
      menuItems: [
        { id: "cut", text: "Cut", shortcut: "x" },
        { id: "copy", text: "Copy", shortcut: "c" },
        { id: "paste", text: "Paste", shortcut: "v" },
        { id: "selectAll", text: "Select All", shortcut: "a" },
      ],
    },
  ];

  await Neutralino.window.setMainMenu(menu);

  Neutralino.events.on("mainMenuItemClicked", async (evt) => {
    console.log(evt.detail.id);
    switch (evt.detail.id) {
      case "open":
        loadFileBtn.click();
        break;
      case "save":
        saveFileBtn.click();
        break;
      case "quit":
        Neutralino.app.exit();
        break;
      case "cut":
        document.execCommand("cut");
        break;
      case "copy":
        document.execCommand("copy");
        break;
      case "paste":
        {
          const text = await Neutralino.clipboard.readText();
          const activeElement = document.activeElement;
          if (
            activeElement.tagName === "INPUT" &&
            activeElement.type === "text"
          ) {
            const start = activeElement.selectionStart;
            const end = activeElement.selectionEnd;
            const value = activeElement.value;
            activeElement.value =
              value.substring(0, start) + text + value.substring(end);
            activeElement.selectionStart = activeElement.selectionEnd =
              start + text.length;
          }
        }
        break;
      case "selectAll":
        {
          const activeElement = document.activeElement;
          if (
            activeElement.tagName === "INPUT" &&
            activeElement.type === "text"
          ) {
            activeElement.select();
          }
        }
        break;
    }
  });
});
