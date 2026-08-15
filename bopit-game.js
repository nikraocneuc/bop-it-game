/* ============================================================
   BOP IT — Playable Prototype
   Game state machine: MENU -> PROMPT -> RESOLVE -> (PROMPT | GAME_OVER) -> MENU
   ============================================================ */

(() => {
  "use strict";

  /* ---------- Config ---------- */
  const ACTIONS = ["pop", "squeeze", "pull"];

  const PROMPT_LABEL = {
    pop: "POP IT!",
    squeeze: "SQUEEZE IT!",
    pull: "PULL IT!",
  };
  const CIRCLE_LABEL = {
    pop: "TAP",
    squeeze: "SQUEEZE",
    pull: "PULL ↓",
  };

  const DIFFICULTY = {
    startMs: 4000,   // time allowed on round 1
    minMs: 1200,     // hardest floor
    stepMs: 180,     // reduction per successful round
  };

  const GESTURE = {
    popMaxMove: 18,      // px — max movement still counted as a tap
    popMaxTime: 450,     // ms — max press duration still counted as a tap
    pullThreshold: 70,   // px downward movement required
    squeezeThreshold: 55,// px inward movement required, per side
    squeezeEdgeZone: 0.35, // fraction of container width from each edge that counts as a valid squeeze start
  };

  const SOUND_SRC = {
    pop: "Pop_it.mp3",
    squeeze: "squeeze_.mp3",
    pull: "pull_down.mp3",
    wrong: "wrong-combo.mp3",
    streak3: "3-done-combos.mp3",
  };

  /* ---------- DOM ---------- */
  const viewMenu = document.getElementById("view-menu");
  const viewGame = document.getElementById("view-game");
  const viewGameOver = document.getElementById("view-gameover");

  const btnPlay = document.getElementById("btn-play");
  const btnAgain = document.getElementById("btn-again");
  const btnMenu = document.getElementById("btn-menu");

  const scoreEl = document.getElementById("score");
  const finalScoreEl = document.getElementById("final-score");
  const timerRingEl = document.getElementById("timer-ring");
  const promptBoxEl = document.getElementById("prompt-box");
  const gameMidEl = document.getElementById("game-mid");
  const circleEl = document.getElementById("circle");
  const circleLabelEl = document.getElementById("circle-label");
  const feedbackEl = document.getElementById("feedback");

  /* ---------- Sound ---------- */
  // A fresh Audio() per play call lets short SFX overlap (e.g. correct-combo + streak3)
  // and lets a cue replay cleanly even if the previous instance hasn't finished.
  function playSound(name) {
    const src = SOUND_SRC[name];
    if (!src) return;
    try {
      const a = new Audio(src);
      a.play().catch(() => {
        /* Autoplay can be blocked before any user gesture; safe to ignore. */
      });
    } catch (e) {
      /* no-op — never let sound errors break gameplay */
    }
  }

  /* ---------- Game state ---------- */
  let score = 0;
  let currentAction = null;
  let roundLocked = true;    // true while no active round is accepting input
  let roundStartTime = 0;
  let roundDuration = DIFFICULTY.startMs;
  let timerRAF = null;
  let timeoutHandle = null;

  // Active pointer tracking for gesture recognition
  const pointers = new Map(); // pointerId -> { startX, startY, x, y, startTime, side }

  /* ---------- View switching ---------- */
  function showView(view) {
    [viewMenu, viewGame, viewGameOver].forEach((v) => v.classList.add("hidden"));
    view.classList.remove("hidden");
  }

  /* ---------- Difficulty ---------- */
  function durationForScore(s) {
    return Math.max(DIFFICULTY.minMs, DIFFICULTY.startMs - s * DIFFICULTY.stepMs);
  }

  /* ---------- Timer ring ---------- */
  function startTimerVisual(duration) {
    const start = performance.now();
    function frame(now) {
      if (roundLocked) return; // round already resolved, stop animating
      const elapsed = now - start;
      const remaining = Math.max(0, 1 - elapsed / duration);
      timerRingEl.style.background =
        `conic-gradient(var(--line-dark) ${remaining * 360}deg, #ddd 0deg)`;
      if (remaining > 0) {
        timerRAF = requestAnimationFrame(frame);
      }
    }
    timerRAF = requestAnimationFrame(frame);
  }
  function stopTimerVisual() {
    if (timerRAF) cancelAnimationFrame(timerRAF);
    timerRAF = null;
  }

  /* ---------- Round lifecycle ---------- */
  function startRound() {
    pointers.clear();
    gameMidEl.classList.remove("mode-squeeze");
    circleEl.classList.remove("state-success", "state-fail");
    feedbackEl.textContent = "";
    feedbackEl.className = "feedback";

    currentAction = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
    roundDuration = durationForScore(score);
    roundStartTime = performance.now();
    roundLocked = false;

    promptBoxEl.textContent = PROMPT_LABEL[currentAction];
    circleLabelEl.textContent = CIRCLE_LABEL[currentAction];

    playSound(currentAction); // instruction cue

    startTimerVisual(roundDuration);
    timeoutHandle = setTimeout(() => resolveRound(null), roundDuration);
  }

  function resolveRound(detectedAction) {
    if (roundLocked) return; // already resolved this round, ignore extra events
    roundLocked = true;
    clearTimeout(timeoutHandle);
    stopTimerVisual();

    const success = detectedAction !== null && detectedAction === currentAction;

    if (success) {
      score += 1;
      scoreEl.textContent = String(score);
      circleEl.classList.add("state-success");
      feedbackEl.textContent = "NICE!";
      feedbackEl.className = "feedback success";

      playSound("correct");
      if (score % 3 === 0) {
        playSound("streak3");
      }

      setTimeout(() => {
        if (!viewGame.classList.contains("hidden")) startRound();
      }, 450);
    } else {
      circleEl.classList.add("state-fail");
      feedbackEl.textContent = detectedAction === null ? "TOO SLOW!" : "WRONG MOVE!";
      feedbackEl.className = "feedback fail";

      playSound("wrong"); // long SFX — allowed to keep playing while we move on

      setTimeout(() => {
        endGame();
      }, 350);
    }
  }

  function endGame() {
    finalScoreEl.textContent = String(score);
    showView(viewGameOver);
  }

  function resetGameState() {
    score = 0;
    scoreEl.textContent = "0";
    roundLocked = true;
    stopTimerVisual();
    clearTimeout(timeoutHandle);
    pointers.clear();
  }

  /* ---------- Gesture recognition ---------- */
  function getContainerRect() {
    return gameMidEl.getBoundingClientRect();
  }

  function classifySide(clientX, rect) {
    const fraction = (clientX - rect.left) / rect.width;
    if (fraction <= GESTURE.squeezeEdgeZone) return "left";
    if (fraction >= 1 - GESTURE.squeezeEdgeZone) return "right";
    return "center";
  }

  function onPointerDown(e) {
    if (roundLocked) return;
    const rect = getContainerRect();
    pointers.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      startTime: performance.now(),
      side: classifySide(e.clientX, rect),
    });
    updateSqueezeHint();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (roundLocked) return;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    checkGestures();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (roundLocked) {
      pointers.delete(e.pointerId);
      return;
    }
    const p = pointers.get(e.pointerId);
    if (p) {
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const dist = Math.hypot(dx, dy);
      const duration = performance.now() - p.startTime;
      const wasOnlyPointer = pointers.size === 1;

      if (wasOnlyPointer && dist <= GESTURE.popMaxMove && duration <= GESTURE.popMaxTime) {
        pointers.delete(e.pointerId);
        resolveRound("pop");
        updateSqueezeHint();
        return;
      }
    }
    pointers.delete(e.pointerId);
    updateSqueezeHint();
  }

  function updateSqueezeHint() {
    const sides = [...pointers.values()].map((p) => p.side);
    const hasLeft = sides.includes("left");
    const hasRight = sides.includes("right");
    gameMidEl.classList.toggle("mode-squeeze", hasLeft && hasRight);
  }

  function checkGestures() {
    if (roundLocked) return;

    // SQUEEZE: two active pointers, one starting left, one starting right,
    // both moving inward past the threshold.
    const active = [...pointers.values()];
    const leftP = active.find((p) => p.side === "left");
    const rightP = active.find((p) => p.side === "right");
    if (leftP && rightP) {
      const leftInward = leftP.x - leftP.startX;   // positive = moved right (inward)
      const rightInward = rightP.startX - rightP.x; // positive = moved left (inward)
      if (leftInward > GESTURE.squeezeThreshold && rightInward > GESTURE.squeezeThreshold) {
        resolveRound("squeeze");
        return;
      }
    }

    // PULL: single active pointer moving downward, dominant over horizontal drift.
    if (active.length === 1) {
      const p = active[0];
      const dy = p.y - p.startY;
      const dx = Math.abs(p.x - p.startX);
      if (dy > GESTURE.pullThreshold && dy > dx * 1.2) {
        resolveRound("pull");
      }
    }
  }

  /* ---------- Wire up pointer events ---------- */
  gameMidEl.addEventListener("pointerdown", onPointerDown);
  gameMidEl.addEventListener("pointermove", onPointerMove);
  gameMidEl.addEventListener("pointerup", onPointerUp);
  gameMidEl.addEventListener("pointercancel", onPointerUp);
  gameMidEl.addEventListener("pointerleave", (e) => {
    // Treat leaving the zone mid-gesture as releasing that pointer, without
    // ending the round — the player may still complete the gesture again.
    pointers.delete(e.pointerId);
    updateSqueezeHint();
  });

  /* ---------- Buttons ---------- */
  btnPlay.addEventListener("click", () => {
    resetGameState();
    showView(viewGame);
    startRound();
  });

  btnAgain.addEventListener("click", () => {
    resetGameState();
    showView(viewGame);
    startRound();
  });

  btnMenu.addEventListener("click", () => {
    resetGameState();
    showView(viewMenu);
  });
})();
