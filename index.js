const protobuf = require("protobufjs");
const fs = require("fs");
const readline = require("readline");

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let battleLogObject = null;
let playerIndex = 0;
let root = null;
let BattleLogFile = null;
let currentDisplayRange = null;
let rounds = [];
let selectedRound = null;

async function main() {
  try {
    root = await protobuf.load("gdxsv.proto");
    BattleLogFile = root.lookupType("proto.BattleLogFile");
    loadFileAndSelectPlayer();
  } catch (err) {
    console.error("Failed to load protobuf:", err);
    rl.close();
  }
}

function loadFileAndSelectPlayer() {
  rl.question(
    "Please enter player index to filter by (1-4): ",
    async (answer) => {
      playerIndex = parseInt(answer, 10);
      if (isNaN(playerIndex) || playerIndex < 1 || playerIndex > 4) {
        console.log("Invalid player index. Exiting.");
        rl.close();
        return;
      }
      try {
        const replayFile = "replays/1753648709739.pb";
        const buffer = fs.readFileSync(replayFile);
        battleLogObject = BattleLogFile.decode(buffer);
        selectRound();
      } catch (err) {
        console.error("Failed to read or decode replay file:", err);
        rl.close();
      }
    }
  );
}

function selectRound() {
  const { startMsgIndexes, inputs } = battleLogObject;
  if (startMsgIndexes && startMsgIndexes.length > 0) {
    console.log("Detected multiple rounds in the replay file.");
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

  if (rounds.length === 1) {
    selectedRound = rounds[0];
    console.log(
      `Only one round found (frames ${selectedRound.start}-${selectedRound.end}). Automatically selected.`
    );
    showMenu();
  } else {
    console.log("Please select a round to edit:");
    rounds.forEach((round, index) => {
      console.log(
        `${index + 1}: Round ${index + 1} (frames ${round.start}-${round.end})`
      );
    });
    rl.question("Enter round number: ", (answer) => {
      const roundIndex = parseInt(answer, 10) - 1;
      if (roundIndex >= 0 && roundIndex < rounds.length) {
        selectedRound = rounds[roundIndex];
        showMenu();
      } else {
        console.log("Invalid round number. Exiting.");
        rl.close();
      }
    });
  }
}

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
        start: startGroupFrame - round.start,
        end: endGroupFrame - round.start,
        input: lastPlayerInput,
      });
      startGroupFrame = i;
      lastPlayerInput = currentPlayerInput;
    }
  }

  // Add the final group
  groups.push({
    start: startGroupFrame - round.start,
    end: round.end - round.start,
    input: lastPlayerInput,
  });

  return groups;
}

function printFrames(displayRange = null) {
  console.log(
    `\n--- Displaying inputs for Player ${playerIndex}, Round ${
      rounds.indexOf(selectedRound) + 1
    } ---`
  );
  if (battleLogObject.inputs && battleLogObject.inputs.length > 0) {
    const p = playerIndex - 1;
    const allGroups = getGroupedFrames(p, selectedRound);

    if (allGroups.length === 0) {
      console.log("No frames to display.");
    } else {
      const groupsToShow = displayRange
        ? allGroups.filter(
            (group) =>
              group.start <= displayRange.end && group.end >= displayRange.start
          )
        : allGroups;

      if (displayRange) {
        console.log(
          `(Showing frames ${displayRange.start} to ${displayRange.end})`
        );
      }

      groupsToShow.forEach((group) => {
        const frameCount = group.end - group.start + 1;
        const buttonNames = getInputButtonNames(group.input) || " ";
        const frameRange = `${group.start}~${group.end}`;
        console.log(
          `Frame ${frameRange}: [${frameCount
            .toString()
            .padStart(2, "0")}] ${buttonNames}`
        );
      });
    }
  } else {
    console.log("No 'inputs' data found to display or edit.");
  }
}

function showMenu(displayRange = null) {
  printFrames(displayRange);

  let prompt = "\n(A)dd, (R)emove, (S)ave, (Q)uit";
  if (displayRange) {
    currentDisplayRange = displayRange;
    prompt = "\n(A)dd, (R)emove, (S)ave, (F)orward, (B)ack, (Q)uit";
  } else {
    currentDisplayRange = null;
  }

  rl.question(`${prompt}: `, (choice) => {
    switch (choice.toUpperCase()) {
      case "A":
        handleAdd();
        break;
      case "R":
        handleRemove();
        break;
      case "S":
        handleSave();
        break;
      case "F":
        if (currentDisplayRange) {
          const newStart = currentDisplayRange.start + 10;
          const newEnd = currentDisplayRange.end + 10;
          if (newStart < battleLogObject.inputs.length) {
            currentDisplayRange = { start: newStart, end: newEnd };
          } else {
            console.log("At the end of the log.");
          }
        } else {
          console.log("No range selected to move forward. Displaying all.");
        }
        showMenu(currentDisplayRange);
        break;
      case "B":
        if (currentDisplayRange) {
          const newStart = Math.max(0, currentDisplayRange.start - 10);
          const newEnd = Math.max(0, currentDisplayRange.end - 10);
          currentDisplayRange = { start: newStart, end: newEnd };
        } else {
          console.log("No range selected to move backward. Displaying all.");
        }
        showMenu(currentDisplayRange);
        break;
      case "Q":
        console.log("Exiting.");
        rl.close();
        break;
      default:
        console.log("Invalid choice.");
        showMenu(currentDisplayRange);
        break;
    }
  });
}

function modifyFrames(startFrame, endFrame, key, action) {
  if (!KEY_NAME_TO_VALUE.has(key.toUpperCase())) {
    console.log("Invalid key.");
    return false;
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
  return true;
}

function handleModification(action) {
  const actionVerb = action === "add" ? "add" : "remove";
  rl.question(
    `Frame range to ${actionVerb} key (e.g., 100~200, relative to round start): `,
    (rangeStr) => {
      const [startFrameStr, endFrameStr] = rangeStr.split("~");
      const relativeStartFrame = parseInt(startFrameStr, 10);
      const relativeEndFrame = parseInt(endFrameStr, 10);

      if (
        isNaN(relativeStartFrame) ||
        isNaN(relativeEndFrame) ||
        relativeStartFrame > relativeEndFrame
      ) {
        console.log("Invalid frame range.");
        showMenu(currentDisplayRange);
        return;
      }

      const absoluteStartFrame = selectedRound.start + relativeStartFrame;
      const absoluteEndFrame = selectedRound.start + relativeEndFrame;
      const roundFrameCount = selectedRound.end - selectedRound.start;

      const displayStart = Math.max(0, relativeStartFrame - 10);
      const displayEnd = Math.min(roundFrameCount, relativeEndFrame + 10);
      const newDisplayRange = { start: displayStart, end: displayEnd };
      printFrames(newDisplayRange);

      rl.question(`Key to ${actionVerb} (e.g., X): `, (key) => {
        if (modifyFrames(absoluteStartFrame, absoluteEndFrame, key, action)) {
          console.log(
            `Key '${key}' ${
              action === "add" ? "added" : "removed"
            } for frames ${relativeStartFrame}-${relativeEndFrame} for Player ${playerIndex}.`
          );
          currentDisplayRange = newDisplayRange;
          showMenu(currentDisplayRange);
        } else {
          showMenu(currentDisplayRange);
        }
      });
    }
  );
}

function handleAdd() {
  handleModification("add");
}

function handleRemove() {
  handleModification("remove");
}

function handleSave() {
  rl.question(
    "Enter new filename (e.g., replay_modified.pb): ",
    (newFilename) => {
      if (!newFilename) {
        console.log("Save cancelled.");
        showMenu();
        return;
      }

      try {
        const newLogFileMessage = BattleLogFile.create(battleLogObject);
        const newBuffer = BattleLogFile.encode(newLogFileMessage).finish();
        fs.writeFileSync(newFilename, newBuffer);
        console.log(`Replay saved successfully to ${newFilename}`);
      } catch (err) {
        console.error("Failed to save replay:", err);
      }
      showMenu();
    }
  );
}

main();
