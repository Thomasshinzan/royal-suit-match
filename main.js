class RoyalMatchGame extends RoyalMatchBoard {
  static SAVE_KEY = 'royalSuitMatchSaveV1';
  static PENDING_FRESH_KEY = 'royalSuitMatchPendingFresh';

  constructor(configData) {
    super(configData);
    this.stages = configData.stages || STAGES;
    this.currentStageIndex = 0;
    this.movesLeft = 0;
    this.stageProgress = {
      collectedSuits: {},
      specialUsedCount: 0,
      cratesDestroyed: 0,
      tokensDropped: 0,
      thawedCount: 0,
      comboCount: 0
    };
    this.score = 0;
    this.combo = 0;
    this.currentComboDisplay = 0;
    this.lastSwappedCells = [];
    this.setupEventListeners();
    if (!this.tryRestoreSave()) {
      this.loadStage(0);
    }
  }

  setupEventListeners() {
    const board = this.boardEl;

    board.addEventListener('touchstart', (e) => {
      if (this.isBusy || this.overlay.classList.contains('active')) return;
      e.preventDefault();
      const touch = e.touches[0];
      const cell = this.getCellFromEvent({ clientX: touch.clientX, clientY: touch.clientY });
      if (cell) {
        this.dragStart = { cell, x: touch.clientX, y: touch.clientY, swiped: false };
      }
    }, { passive: false });

    board.addEventListener('touchmove', (e) => {
      if (!this.dragStart || this.isBusy || this.overlay.classList.contains('active')) return;
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - this.dragStart.x;
      const dy = touch.clientY - this.dragStart.y;
      const threshold = 20;

      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        this.dragStart.swiped = true;
        const origin = this.dragStart.cell;
        let targetR = origin.r;
        let targetC = origin.c;

        if (Math.abs(dx) > Math.abs(dy)) targetC += dx > 0 ? 1 : -1;
        else targetR += dy > 0 ? 1 : -1;

        this.clearSelection();
        if (this.isValidCell(targetR, targetC) && !this.isCrateCell(origin.r, origin.c) && !this.isCrateCell(targetR, targetC) && !this.isHoleCell(origin.r, origin.c) && !this.isHoleCell(targetR, targetC) && !this.isFrozenCell(origin.r, origin.c) && !this.isFrozenCell(targetR, targetC) && !this.isFlipBlockCell(origin.r, origin.c) && !this.isFlipBlockCell(targetR, targetC)) {
          this.attemptSwap(origin, { r: targetR, c: targetC });
        }
      }
    }, { passive: false });

    board.addEventListener('pointerdown', (e) => {
      if (this.isBusy || this.overlay.classList.contains('active')) return;
      const cell = this.getCellFromEvent(e);
      if (cell) {
        this.dragStart = { cell, x: e.clientX, y: e.clientY, swiped: false };
      }
    });

    board.addEventListener('pointermove', (e) => {
      if (!this.dragStart || this.isBusy || this.overlay.classList.contains('active')) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const threshold = 20;

      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        this.dragStart.swiped = true;
        const origin = this.dragStart.cell;
        let targetR = origin.r;
        let targetC = origin.c;

        if (Math.abs(dx) > Math.abs(dy)) targetC += dx > 0 ? 1 : -1;
        else targetR += dy > 0 ? 1 : -1;

        this.clearSelection();
        if (this.isValidCell(targetR, targetC) && !this.isCrateCell(origin.r, origin.c) && !this.isCrateCell(targetR, targetC) && !this.isHoleCell(origin.r, origin.c) && !this.isHoleCell(targetR, targetC) && !this.isFrozenCell(origin.r, origin.c) && !this.isFrozenCell(targetR, targetC) && !this.isFlipBlockCell(origin.r, origin.c) && !this.isFlipBlockCell(targetR, targetC)) {
          this.attemptSwap(origin, { r: targetR, c: targetC });
        }
      }
    });

    window.addEventListener('pointerup', () => {
      if (!this.dragStart) return;
      const { cell, swiped } = this.dragStart;
      this.dragStart = null;

      if (!swiped && !this.isBusy && !this.overlay.classList.contains('active')) {
        this.handleCellTap(cell);
      }
    });

    const btnSound = document.getElementById('btn-sound');
    btnSound?.addEventListener('click', () => {
      const isMuted = this.sound.toggleMute();
      btnSound.textContent = isMuted ? '🔇 音: OFF' : '🔊 音: OFF';
    });

    document.getElementById('btn-stage-select')?.addEventListener('click', () => {
      if (this.isBusy) return;
      const nextIdx = (this.currentStageIndex + 1) % this.stages.length;
      this.loadStage(nextIdx);
    });

    document.getElementById('btn-reset')?.addEventListener('click', () => {
      if (!this.isBusy) this.loadStage(this.currentStageIndex);
    });

    document.getElementById('btn-clear-save')?.addEventListener('click', () => {
      if (this.isBusy) return;
      this.clearSave();
      this.loadStage(0);
    });

    this.overlayBtn?.addEventListener('click', () => {
      if (this.stageActionType === 'next') this.loadStage(this.currentStageIndex + 1);
      else if (this.stageActionType === 'restart_all') this.loadStage(this.currentStageIndex);
      else this.loadStage(this.currentStageIndex);
    });
  }

  async handleCellTap(cell) {
    const tappedTile = this.grid[cell.r]?.[cell.c];
    if (!tappedTile || tappedTile.isCrate || tappedTile.isFrozen || (tappedTile.isFlip && tappedTile.flipForm === 'block')) return;

    if (this.selectedCell) {
      if (this.selectedCell.r === cell.r && this.selectedCell.c === cell.c) {
        if (this.isTapActivatableSpecial(tappedTile)) {
          this.clearSelection();
          await this.activateSingleSpecialByTap(cell.r, cell.c);
        } else {
          this.clearSelection();
        }
        return;
      } else if (this.isAdjacent(this.selectedCell, cell)) {
        const from = { ...this.selectedCell };
        this.clearSelection();
        await this.attemptSwap(from, cell);
        return;
      }
    }

    if (this.isTapActivatableSpecial(tappedTile)) {
      this.clearSelection();
      await this.activateSingleSpecialByTap(cell.r, cell.c);
      return;
    }

    this.selectCell(cell.r, cell.c);
  }

  recordRemovedTileProgress(tile, r, c) {
    if (!tile || tile.isCrate) return;
    let id = tile.def.id;
    if (id === 'wild') {
      // ワイルドは属したマッチのスートとして数える
      // （マッチ以外＝特殊効果で消えた場合は数えない）
      id = this.currentCellSuits?.get(`${r},${c}`);
      if (!id) return;
    }
    this.stageProgress.collectedSuits[id] = (this.stageProgress.collectedSuits[id] || 0) + 1;
  }

  recordSpecialUsedProgress(count = 1) {
    this.stageProgress.specialUsedCount += count;
  }

  recordTokenProgress(count = 1) {
    this.stageProgress.tokensDropped += count;
  }

  recordThawProgress(count = 1) {
    this.stageProgress.thawedCount += count;
  }

  recordComboProgress(count = 1) {
    this.stageProgress.comboCount += count;
  }

  // 消去の共通入口：凍結タイルは消えずに解凍され、解凍数が加算される。
  // お邪魔形態の変転タイルは消去自体が無効になる。
  removeOrThawTile(tile, r, c) {
    if (!tile) return;
    if (tile.isFlip && tile.flipForm === 'block') return; // お邪魔は消去できない
    if (tile.isFrozen) {
      this.thawTile(tile);
      this.recordThawProgress();
      this.updateStageObjectivesUI();
      return;
    }
    this.recordRemovedTileProgress(tile, r, c);
    tile.el.remove();
    if (this.grid[r]?.[c] === tile) this.grid[r][c] = null;
  }

  isStageCleared() {
    const stage = this.stages[this.currentStageIndex];
    if (!stage) return false;
    return stage.objectives.every(obj => {
      if (obj.type === 'collect_suit') return (this.stageProgress.collectedSuits[obj.suitId] || 0) >= obj.target;
      if (obj.type === 'destroy_crates') return this.stageProgress.cratesDestroyed >= obj.target;
      if (obj.type === 'use_special') return this.stageProgress.specialUsedCount >= obj.target;
      if (obj.type === 'drop_token') return this.stageProgress.tokensDropped >= obj.target;
      if (obj.type === 'thaw_frozen') return this.stageProgress.thawedCount >= obj.target;
      if (obj.type === 'special_combo') return this.stageProgress.comboCount >= obj.target;
      if (obj.type === 'score') return this.score >= obj.target;
      return false;
    });
  }

  evaluateStageEndState() {
    // 手を消費したので、変化タイルを次のスートへ進め、変転タイルを
    // 反転させてから判定・保存する
    this.advanceChangerTiles();
    this.flipTiles();
    this.updateStageObjectivesUI();
    if (this.isStageCleared()) {
      const nextIdx = this.currentStageIndex + 1;
      if (nextIdx < this.stages.length) {
        this.markPendingFresh(nextIdx);
      } else {
        // 全ステージクリア後は最終ステージをセーブし直し、リロードで
        // 最終ステージに戻る（ステージ選択での手動移動も保存される）
        this.markPendingFresh(this.currentStageIndex);
      }
      this.showOverlay('STAGE CLEAR!', 'お見事！ステージをクリアしました！', '次のステージへ');
      this.stageActionType = 'next';
      return true;
    }
    if (this.movesLeft <= 0) {
      this.markPendingFresh(this.currentStageIndex);
      this.showOverlay('STAGE FAILED...', '残念！手数が尽きました。同じステージをもう一度！', 'リトライ');
      this.stageActionType = 'retry';
      return true;
    }
    this.saveGame();
    return false;
  }

  async attemptSwap(posA, posB) {
    if (this.isBusy) return;
    if (!this.isAdjacent(posA, posB)) return;
    if (this.isCrateCell(posA.r, posA.c) || this.isCrateCell(posB.r, posB.c) || this.isHoleCell(posA.r, posA.c) || this.isHoleCell(posB.r, posB.c) || this.isFrozenCell(posA.r, posA.c) || this.isFrozenCell(posB.r, posB.c) || this.isFlipBlockCell(posA.r, posA.c) || this.isFlipBlockCell(posB.r, posB.c) || this.hasPartitionBetween(posA, posB)) return;

    const tileA = this.grid[posA.r][posA.c];
    const tileB = this.grid[posB.r][posB.c];
    if (!tileA || !tileB) return;

    // ペアコンボ（スペシャル同士の入れ替え）を最優先で判定
    if (tileA.specialId && tileB.specialId) {
      this.isBusy = true;
      this.movesLeft--;
      this.updateHUD();
      this.swapTilesInGrid(posA, posB);
      this.lastSwappedCells = [posA, posB];
      await this.sleep(200);
      await this.executeSpecialPairCombo(posA, posB);
      if (!this.evaluateStageEndState()) {
        await this.ensurePlayableBoard();
      }
      this.isBusy = false;
      return;
    }

    this.isBusy = true;
    this.swapTilesInGrid(posA, posB);
    this.lastSwappedCells = [posA, posB];
    await this.sleep(120);

    const specialTileInfo = tileA.specialId
      ? { tile: tileA, pos: posB }
      : (tileB.specialId ? { tile: tileB, pos: posA } : null);
    const normalMatch = this.findAllMatches();

    // 通常マッチが成立すればスペシャル単体の発動より優先
    if (normalMatch.cells.length > 0) {
      this.movesLeft--;
      this.updateHUD();
      this.combo = 0;
      await this.resolveCascadeLoop(normalMatch);
      if (!this.evaluateStageEndState()) {
        await this.ensurePlayableBoard();
      }
      this.isBusy = false;
      return;
    }

    // マッチ不成立でも、スペシャルと通常タイルの入れ替えならスペシャルが発動
    if (specialTileInfo) {
      this.movesLeft--;
      this.updateHUD();
      await this.triggerSpecialActivationsAndCascade([{
        r: specialTileInfo.pos.r,
        c: specialTileInfo.pos.c,
        specialId: specialTileInfo.tile.specialId,
        swappedWithSuitId: (specialTileInfo.tile === tileA ? tileB : tileA).def.id
      }]);
      if (!this.evaluateStageEndState()) {
        await this.ensurePlayableBoard();
      }
      this.isBusy = false;
      return;
    }

    // マッチ不成立：元に戻す
    this.swapTilesInGrid(posA, posB);
    this.lastSwappedCells = [];
    await this.sleep(120);
    this.isBusy = false;
  }

  isTapActivatableSpecial(tile) {
    if (!tile || !tile.specialId) return false;
    const def = this.specialMap.get(tile.specialId);
    return Boolean(def?.tapActivatable);
  }

  async activateSingleSpecialByTap(r, c) {
    if (this.isBusy) return;
    const tile = this.grid[r][c];
    if (!tile?.specialId) return;
    this.isBusy = true;
    this.movesLeft--;
    this.updateHUD();
    await this.triggerSpecialActivationsAndCascade([{
      r, c, specialId: tile.specialId, swappedWithSuitId: null
    }]);
    if (!this.evaluateStageEndState()) {
      await this.ensurePlayableBoard();
    }
    this.isBusy = false;
  }

  // スペシャル同士を入れ替えた時のコンボ。A同士は盤面の2スート全消去、
  // それ以外は2つの効果を合成して発動する。
  async executeSpecialPairCombo(posA, posB) {
    this.recordComboProgress();
    const tileA = this.grid[posA.r][posA.c];
    const tileB = this.grid[posB.r][posB.c];
    if (!tileA?.specialId || !tileB?.specialId) return;

    const rankA = this.specialMap.get(tileA.specialId)?.rank;
    const rankB = this.specialMap.get(tileB.specialId)?.rank;

    const destroySet = new Set();
    const crateSet = new Set();
    const chainQueue = [];

    const addCellToDestroy = (r, c, allowChain = true) => {
      const key = `${r},${c}`;
      if (destroySet.has(key)) return;
      const tile = this.grid[r]?.[c];
      if (!tile) return;
      if (tile.isCrate) { crateSet.add(key); return; }
      if (tile.isToken) return;
      destroySet.add(key);
      if (allowChain && tile.specialId) {
        chainQueue.push({ r, c, specialId: tile.specialId, swappedWithSuitId: null });
      }
    };

    if (rankA === 'A' && rankB === 'A') {
      // A+A：盤面の2スートをランダムに選んで全消去
      const suitsOnBoard = [...new Set(
        Array.from({ length: this.rows }, (_, r) =>
          Array.from({ length: this.cols }, (_, c) => this.grid[r][c])
        ).flat().filter(t => t && !t.isCrate && !t.isToken).map(t => t.def.id)
      )];
      const shuffled = [...suitsOnBoard].sort(() => Math.random() - 0.5);
      const targets = shuffled.slice(0, Math.min(2, shuffled.length));
      const bannerSuits = targets.map(id => this.tileMap.get(id)).filter(Boolean);
      this.showComboBanner(`Aコンボ：${bannerSuits.map(d => d.symbol).join(' と ')} を全消去！`);
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tile = this.grid[r][c];
          if (tile && targets.includes(tile.def.id)) addCellToDestroy(r, c);
        }
      }
    } else {
      // それ以外：両スペシャルの効果範囲を合成
      const effA = this.computeSingleSkillEffect({ r: posA.r, c: posA.c, specialId: tileA.specialId, swappedWithSuitId: tileB.def.id }, new Set());
      const effB = this.computeSingleSkillEffect({ r: posB.r, c: posB.c, specialId: tileB.specialId, swappedWithSuitId: tileA.def.id }, new Set());
      addCellToDestroy(posA.r, posA.c, false);
      addCellToDestroy(posB.r, posB.c, false);
      for (const cell of effA.targets) addCellToDestroy(cell.r, cell.c);
      for (const cell of effB.targets) addCellToDestroy(cell.r, cell.c);
    }

    const chainedEffects = [];
    const activatedKeys = new Set([`${posA.r},${posA.c}`, `${posB.r},${posB.c}`]);
    while (chainQueue.length > 0) {
      const trig = chainQueue.shift();
      const key = `${trig.r},${trig.c}`;
      if (activatedKeys.has(key)) continue;
      activatedKeys.add(key);
      const eff = this.computeSingleSkillEffect(trig, destroySet);
      chainedEffects.push(eff);
      for (const cell of eff.targets) addCellToDestroy(cell.r, cell.c);
    }

    const allEffects = [
      { targets: Array.from(destroySet).map(k => { const [r, c] = k.split(',').map(Number); return { r, c }; }), isPairCombo: true },
      ...chainedEffects
    ];
    this.playSkillEffects(allEffects, true);
    this.recordSpecialUsedProgress(2 + chainedEffects.length);

    await this.sleep(250);

    const cellsToRemove = Array.from(destroySet).map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    });
    const cardTargets = cellsToRemove.filter(({ r, c }) => !this.isCrateCell(r, c) && !this.isTokenCell(r, c) && !this.isFlipBlockCell(r, c));
    const crateTargets = cellsToRemove.filter(({ r, c }) => this.isCrateCell(r, c));

    let roundPoints = 0;
    let centerR = 0;
    let centerC = 0;
    for (const { r, c } of cardTargets) {
      const tile = this.grid[r][c];
      if (!tile) continue;
      roundPoints += Math.round(this.config.baseMatchScore * tile.def.scoreWeight * 2);
      centerR += r;
      centerC += c;
      tile.el.classList.add('matched');
      this.spawnSparkles(r, c);
    }

    const destroyedCrates = this.damageCratesAtCells(crateTargets);
    roundPoints += destroyedCrates * 150 * 2;
    this.stageProgress.cratesDestroyed += destroyedCrates;

    for (const { r, c } of crateTargets) this.damageCratesAtCells([{ r, c }]);
    this.stageProgress.cratesDestroyed += 0;

    this.score += roundPoints;
    this.updateHUD(true);

    if (cardTargets.length > 0) {
      this.spawnFloatingScore(centerR / cardTargets.length, centerC / cardTargets.length, roundPoints, 2);
    }

    await this.sleep(this.config.timingsMs.matchPop);

    for (const { r, c } of cardTargets) {
      this.removeOrThawTile(this.grid[r][c], r, c);
    }
    this.updateStageObjectivesUI();

    await this.applyGravityAndRefill();
    await this.collectDroppedTokensAndRefill();
    const nextMatches = this.findAllMatches();
    if (nextMatches.cells.length > 0) {
      this.combo = 1;
      await this.resolveCascadeLoop(nextMatches);
    }
  }

  showComboBanner(text) {
    const banner = document.createElement('div');
    banner.className = 'skill-cutin-banner';
    banner.style.setProperty('--skill-color', '#f43f5e');
    banner.innerHTML = `
      <span class="skill-cutin-badge">💥</span>
      <span class="skill-cutin-text">${text}</span>
    `;
    this.fxLayer.appendChild(banner);
    setTimeout(() => banner.remove(), 1250);
  }

  planSpecialCardSpawns(groups) {
    const spawnPlans = [];
    const protectedKeys = new Set();

    const pickPivotCell = (cells) => {
      for (const sw of this.lastSwappedCells) {
        const found = cells.find(cell => cell.r === sw.r && cell.c === sw.c && !this.grid[cell.r]?.[cell.c]?.isFrozen && this.grid[cell.r]?.[cell.c]?.def.id !== 'wild');
        if (found) return found;
      }
      const nonWild = cells.filter(cell => this.grid[cell.r]?.[cell.c]?.def.id !== 'wild');
      const nonFrozen = nonWild.filter(cell => !this.grid[cell.r]?.[cell.c]?.isFrozen);
      const pool = nonFrozen.length > 0 ? nonFrozen : (nonWild.length > 0 ? nonWild : cells);
      return pool[Math.floor(pool.length / 2)];
    };

    for (const group of groups) {
      const count = group.cells.length;
      if (count < 4) continue;

      const uniqueRows = new Set(group.cells.map(c => c.r));
      const uniqueCols = new Set(group.cells.map(c => c.c));
      const isStraightLine = uniqueRows.size === 1 || uniqueCols.size === 1;
      const pivot = pickPivotCell(group.cells);
      const pivotKey = `${pivot.r},${pivot.c}`;

      if (this.grid[pivot.r]?.[pivot.c]?.specialId) continue;

      let specialId = null;
      if (count >= 6) specialId = 'mega_6';
      else if (count === 5 && group.hasHoriz && group.hasVert && !isStraightLine) specialId = 'lt_5';
      else if (count === 5 && isStraightLine) specialId = 'line_5';
      else if (count === 4 && isStraightLine) specialId = 'line_4';

      if (specialId && !protectedKeys.has(pivotKey)) {
        protectedKeys.add(pivotKey);
        spawnPlans.push({ r: pivot.r, c: pivot.c, specialId });
      }
    }

    return { spawnPlans, protectedKeys };
  }

  computeSingleSkillEffect(trigger, alreadyDestroyedSet) {
    const { r, c, specialId, swappedWithSuitId } = trigger;
    const skillDef = this.specialMap.get(specialId);
    const affectedCells = [];
    let orientation = null;

    const canHit = (tr, tc) => {
      const key = `${tr},${tc}`;
      return this.isValidCell(tr, tc) && this.grid[tr][tc] !== null && !alreadyDestroyedSet.has(key);
    };

    if (specialId === 'line_4') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (canHit(nr, nc)) affectedCells.push({ r: nr, c: nc });
        }
      }
    } else if (specialId === 'line_5') {
      orientation = 'vertical';
      for (let row = 0; row < this.rows; row++) {
        if (canHit(row, c)) affectedCells.push({ r: row, c });
      }
    } else if (specialId === 'lt_5') {
      orientation = 'horizontal';
      for (let col = 0; col < this.cols; col++) {
        if (canHit(r, col)) affectedCells.push({ r, c: col });
      }
    } else if (specialId === 'mega_6') {
      let targetSuit = swappedWithSuitId;
      if (!targetSuit) {
        const presentSuits = new Set();
        for (let rr = 0; rr < this.rows; rr++) {
          for (let cc = 0; cc < this.cols; cc++) {
            const t = this.grid[rr][cc];
            if (t && !t.isCrate && !t.isToken) presentSuits.add(t.def.id);
          }
        }
        const suitIds = [...presentSuits];
        targetSuit = suitIds[Math.floor(Math.random() * suitIds.length)];
      }
      for (let rr = 0; rr < this.rows; rr++) {
        for (let cc = 0; cc < this.cols; cc++) {
          const t = this.grid[rr][cc];
          if (t && t.def.id === targetSuit && canHit(rr, cc)) affectedCells.push({ r: rr, c: cc });
        }
      }
    }

    return { r, c, specialId, targets: affectedCells, orientation, color: skillDef?.color || '#fff', icon: skillDef?.icon || '' };
  }

  playSkillEffects(effects, isChained = false) {
    for (const eff of effects) {
      if (eff.specialId === 'line_5' || eff.specialId === 'lt_5') {
        const beam = document.createElement('div');
        beam.className = `skill-beam ${eff.orientation === 'vertical' ? 'beam-vertical' : 'beam-horizontal'}`;
        beam.style.setProperty('--skill-color', eff.color);
        const cellPercent = 100 / this.cols;
        if (eff.orientation === 'vertical') {
          beam.style.left = `calc(${eff.c * cellPercent}% + 3px)`;
          beam.style.width = `calc(${cellPercent}% - 6px)`;
        } else {
          beam.style.top = `calc(${eff.r * cellPercent}% + 3px)`;
          beam.style.height = `calc(${cellPercent}% - 6px)`;
        }
        this.fxLayer.appendChild(beam);
        setTimeout(() => beam.remove(), 500);
      } else if (eff.specialId === 'mega_6') {
        const flash = document.createElement('div');
        flash.className = 'skill-flash';
        flash.style.setProperty('--skill-color', eff.color);
        this.fxLayer.appendChild(flash);
        setTimeout(() => flash.remove(), 500);
      }
    }

    const bannerEffects = effects.filter(e => e.specialId);
    if (bannerEffects.length > 0 && !isChained) {
      const eff = bannerEffects[0];
      const banner = document.createElement('div');
      banner.className = 'skill-cutin-banner';
      banner.style.setProperty('--skill-color', eff.color);
      banner.innerHTML = `
        <span class="skill-cutin-badge">${eff.icon}</span>
        <span class="skill-cutin-text">${this.specialMap.get(eff.specialId)?.name || ''} 発動！</span>
      `;
      this.fxLayer.appendChild(banner);
      setTimeout(() => banner.remove(), 1250);
    }
  }

  async triggerSpecialActivationsAndCascade(initialTriggers) {
    const queue = [...initialTriggers];
    const activatedKeys = new Set();
    const allEffects = [];
    const destroySet = new Set();
    const crateSet = new Set();

    const addCellToDestroy = (r, c) => {
      const key = `${r},${c}`;
      const tile = this.grid[r]?.[c];
      if (!tile) return;
      if (tile.isCrate) { crateSet.add(key); return; }
      if (tile.isToken) return;
      if (destroySet.has(key)) return;
      destroySet.add(key);
      if (tile.specialId && !activatedKeys.has(key)) {
        queue.push({ r, c, specialId: tile.specialId, swappedWithSuitId: null });
      }
    };

    for (const trig of initialTriggers) {
      addCellToDestroy(trig.r, trig.c);
    }

    while (queue.length > 0) {
      const trig = queue.shift();
      const key = `${trig.r},${trig.c}`;
      if (activatedKeys.has(key)) continue;
      activatedKeys.add(key);

      const eff = this.computeSingleSkillEffect(trig, destroySet);
      allEffects.push(eff);
      for (const cell of eff.targets) addCellToDestroy(cell.r, cell.c);
    }

    this.playSkillEffects(allEffects);
    this.recordSpecialUsedProgress(allEffects.length);
    await this.sleep(250);

    const allDestroyCells = Array.from(destroySet).map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    });
    const cardTargets = allDestroyCells.filter(({ r, c }) => !this.isCrateCell(r, c) && !this.isTokenCell(r, c) && !this.isFlipBlockCell(r, c));
    const crateTargets = allDestroyCells.filter(({ r, c }) => this.isCrateCell(r, c));

    let roundPoints = 0;
    let centerR = 0;
    let centerC = 0;
    for (const { r, c } of cardTargets) {
      const tile = this.grid[r][c];
      if (!tile) continue;
      roundPoints += Math.round(this.config.baseMatchScore * tile.def.scoreWeight * 1);
      centerR += r;
      centerC += c;
      tile.el.classList.add('matched');
      this.spawnSparkles(r, c);
    }

    const destroyedCrates = this.damageCratesAtCells(crateTargets);
    roundPoints += destroyedCrates * 150;
    this.stageProgress.cratesDestroyed += destroyedCrates;

    this.score += roundPoints;
    this.updateHUD(true);

    if (cardTargets.length > 0) {
      this.spawnFloatingScore(
        centerR / cardTargets.length,
        centerC / cardTargets.length,
        roundPoints,
        1
      );
    }

    await this.sleep(this.config.timingsMs.matchPop);

    for (const { r, c } of cardTargets) {
      this.removeOrThawTile(this.grid[r][c], r, c);
    }
    this.updateStageObjectivesUI();

    await this.applyGravityAndRefill();
    await this.collectDroppedTokensAndRefill();
    const nextMatches = this.findAllMatches();
    if (nextMatches.cells.length > 0) {
      this.combo = 0;
      await this.resolveCascadeLoop(nextMatches);
    }
  }

  async resolveCascadeLoop(initialMatchData) {
    let currentMatchData = initialMatchData;

    while (currentMatchData.cells.length > 0) {
      this.currentCellSuits = currentMatchData.cellSuits || null;
      this.combo++;
      this.sound.playMatch(this.combo);

      const { spawnPlans, protectedKeys } = this.planSpecialCardSpawns(currentMatchData.groups);
      const chainTriggers = [];
      const destroySet = new Set();
      const adjacentCrateKeys = new Set();

      for (const { r, c } of currentMatchData.cells) {
        const key = `${r},${c}`;
        if (!protectedKeys.has(key)) destroySet.add(key);

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (this.isValidCell(nr, nc) && this.isCrateCell(nr, nc)) {
            adjacentCrateKeys.add(`${nr},${nc}`);
          }
        }

        const tile = this.grid[r][c];
        if (!tile?.isCrate && tile?.specialId) {
          chainTriggers.push({ r, c, specialId: tile.specialId, swappedWithSuitId: null });
        }
      }

      const activatedKeys = new Set();
      const triggeredVisuals = [];
      while (chainTriggers.length > 0) {
        const trig = chainTriggers.shift();
        const tKey = `${trig.r},${trig.c}`;
        if (activatedKeys.has(tKey)) continue;
        activatedKeys.add(tKey);
        destroySet.add(tKey);

        const effect = this.computeSingleSkillEffect(trig, destroySet);
        triggeredVisuals.push(effect);
        for (const target of effect.targets) {
          const k = `${target.r},${target.c}`;
          if (protectedKeys.has(k)) continue;
          destroySet.add(k);
          const targetTile = this.grid[target.r]?.[target.c];
          if (targetTile?.specialId && !activatedKeys.has(k)) {
            chainTriggers.push({ r: target.r, c: target.c, specialId: targetTile.specialId, swappedWithSuitId: null });
          }
        }
      }

      if (triggeredVisuals.length > 0) {
        this.playSkillEffects(triggeredVisuals, true);
        this.recordSpecialUsedProgress(triggeredVisuals.length);
        await this.sleep(200);
      }

      const multiplier = 1 + (this.combo - 1) * this.config.comboMultiplierStep;
      let roundPoints = 0;
      let centerR = 0;
      let centerC = 0;

      const cellsToRemove = Array.from(destroySet).map(k => {
        const [r, c] = k.split(',').map(Number);
        return { r, c };
      });

      const crateKeys = new Set(adjacentCrateKeys);
      const cardTargets = [];
      for (const cell of cellsToRemove) {
        if (this.isCrateCell(cell.r, cell.c)) crateKeys.add(`${cell.r},${cell.c}`);
        else if (!this.isTokenCell(cell.r, cell.c) && !this.isFlipBlockCell(cell.r, cell.c)) cardTargets.push(cell);
      }

      const crateTargets = Array.from(crateKeys).map(k => {
        const [r, c] = k.split(',').map(Number);
        return { r, c };
      });

      for (const { r, c } of cardTargets) {
        const tile = this.grid[r][c];
        if (!tile) continue;
        roundPoints += Math.round(this.config.baseMatchScore * tile.def.scoreWeight * multiplier);
        centerR += r;
        centerC += c;
        tile.el.classList.add('matched');
        this.spawnSparkles(r, c);
      }

      const destroyedCrates = this.damageCratesAtCells(crateTargets);
      roundPoints += Math.round(destroyedCrates * 150 * multiplier);

      for (const plan of spawnPlans) {
        const specDef = this.specialMap.get(plan.specialId);
        if (specDef) {
          roundPoints += Math.round(specDef.bonusScore * 0.5 * multiplier);
          this.spawnSparkles(plan.r, plan.c);

          const banner = document.createElement('div');
          banner.className = 'skill-cutin-banner';
          banner.style.setProperty('--skill-color', specDef.color);
          banner.innerHTML = `
            <span class="skill-cutin-badge">${specDef.icon}</span>
            <span class="skill-cutin-text">${specDef.name} 誕生！</span>
          `;
          this.fxLayer.appendChild(banner);
          setTimeout(() => banner.remove(), 1250);
        }
      }

      this.score += roundPoints;
      this.updateHUD(true);

      if (cardTargets.length > 0) {
        this.spawnFloatingScore(
          centerR / cardTargets.length,
          centerC / cardTargets.length,
          roundPoints,
          this.combo
        );
      }

      await this.sleep(this.config.timingsMs.matchPop);

      for (const { r, c } of cardTargets) {
        this.removeOrThawTile(this.grid[r][c], r, c);
      }
      this.updateStageObjectivesUI();

      for (const plan of spawnPlans) {
        const tile = this.grid[plan.r]?.[plan.c];
        if (tile) {
          if (tile.isFrozen) { this.thawTile(tile); this.recordThawProgress(); }
          this.upgradeTileToSpecial(tile, plan.specialId);
          this.sound.playSkill(plan.specialId);
        }
      }

      this.lastSwappedCells = [];
      await this.applyGravityAndRefill();
      await this.collectDroppedTokensAndRefill();
      currentMatchData = this.findAllMatches();
    }
  }

  spawnFloatingScore(r, c, points, comboLvl) {
    const el = document.createElement('div');
    el.className = 'floating-score';
    const cellPercent = 100 / this.cols;
    el.style.left = `${(c + 0.5) * cellPercent}%`;
    el.style.top = `${(r + 0.5) * cellPercent}%`;
    el.textContent = `+${points}`;
    this.fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  loadStage(stageIndex) {
    if (stageIndex < 0 || stageIndex >= this.stages.length) return;
    this.currentStageIndex = stageIndex;
    const stage = this.stages[stageIndex];

    this.clearSelection();
    this.tileLayer.innerHTML = '';
    this.fxLayer.innerHTML = '';
    this.hintLayer.innerHTML = '';
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    this.score = 0;
    this.combo = 0;
    this.movesLeft = stage.moves;
    this.stageProgress = {
      collectedSuits: {},
      specialUsedCount: 0,
      cratesDestroyed: 0,
      tokensDropped: 0,
      thawedCount: 0,
      comboCount: 0
    };
    if (typeof this.stageProgress.comboCount !== 'number') this.stageProgress.comboCount = 0;
    this.lastSwappedCells = [];
    this.stageActionType = null;
    this.hideOverlay();

    this.setHoleMap(stage.holeMap || null);
    this.setPartitionMap(stage.partitionMap || null);
    this.setPartitionHMap(stage.partitionHMap || null);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isHoleCell(r, c)) continue;

        if (stage.tokenMap?.[r]?.[c]) {
          this.grid[r][c] = this.createTokenObject(r, c);
          continue;
        }

        if (stage.crateMap?.[r]?.[c]) {
          const crateDef = this.config.crates.find(cr => cr.id === stage.crateMap[r][c]);
          if (crateDef) {
            this.grid[r][c] = this.createCrateObject(crateDef, r, c);
            continue;
          }
        }

        const forbidden = new Set();
        if (c >= 2) {
          const left1 = this.grid[r][c - 1];
          const left2 = this.grid[r][c - 2];
          if (left1 && left2 && !left1.isCrate && !left1.isToken && !left2.isCrate && !left2.isToken && left1.def.id === left2.def.id) {
            forbidden.add(left1.def.id);
          }
        }
        if (r >= 2) {
          const up1 = this.grid[r - 1][c];
          const up2 = this.grid[r - 2][c];
          if (up1 && up2 && !up1.isCrate && !up1.isToken && !up2.isCrate && !up2.isToken && up1.def.id === up2.def.id) {
            forbidden.add(up1.def.id);
          }
        }
        const def = this.getRandomTileDef(forbidden);
        this.grid[r][c] = this.createTileObject(def, r, c);
      }
    }

    const frozenMap = stage.frozenMap || null;
    if (frozenMap) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tile = this.grid[r][c];
          if (frozenMap[r]?.[c] && tile && !tile.isCrate && !tile.isToken) this.setTileFrozen(tile);
        }
      }
    }

    const changeMap = stage.changeMap || null;
    if (changeMap) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tile = this.grid[r][c];
          if (changeMap[r]?.[c] && tile && !tile.isCrate && !tile.isToken) this.setTileChanger(tile);
        }
      }
    }

    const flipMap = stage.flipMap || null;
    if (flipMap) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tile = this.grid[r][c];
          if (flipMap[r]?.[c] && tile && !tile.isCrate && !tile.isToken) this.setTileFlip(tile);
        }
      }
    }

    this.breakInitialMatches();
    this.ensurePlayableBoard();
    this.updateHUD();
    this.updateStageObjectivesUI();
    this.saveGame();
  }

  updateHUD(animateScore = false) {
    const stageLabel = document.getElementById('stage-label');
    if (stageLabel) stageLabel.textContent = this.stages[this.currentStageIndex].title;
    const movesEl = document.getElementById('moves-left');
    if (movesEl) movesEl.textContent = this.movesLeft;
    const scoreEl = document.getElementById('score');
    if (scoreEl) {
      if (animateScore && scoreEl.textContent !== String(this.score)) {
        scoreEl.classList.remove('score-pop');
        void scoreEl.offsetWidth;
        scoreEl.classList.add('score-pop');
      }
      scoreEl.textContent = this.score;
    }
    const stageBtn = document.getElementById('btn-stage-select');
    if (stageBtn) stageBtn.textContent = `${this.currentStageIndex + 1} / ${this.stages.length}`;
  }

  updateStageObjectivesUI() {
    const container = document.getElementById('objectives-container');
    if (!container) return;
    const stage = this.stages[this.currentStageIndex];
    const items = stage.objectives.map(obj => {
      let icon = '🎯';
      let current = 0;
      if (obj.type === 'collect_suit') {
        const def = this.tileMap.get(obj.suitId);
        icon = def ? def.symbol : '🎯';
        current = this.stageProgress.collectedSuits[obj.suitId] || 0;
      } else if (obj.type === 'destroy_crates') {
        icon = '📦';
        current = this.stageProgress.cratesDestroyed;
      } else if (obj.type === 'use_special') {
        icon = '✨';
        current = this.stageProgress.specialUsedCount;
      } else if (obj.type === 'drop_token') {
        icon = '👑';
        current = this.stageProgress.tokensDropped;
      } else if (obj.type === 'thaw_frozen') {
        icon = '❄';
        current = this.stageProgress.thawedCount;
      } else if (obj.type === 'special_combo') {
        icon = '💥';
        current = this.stageProgress.comboCount;
      } else if (obj.type === 'score') {
        icon = '⭐';
        current = this.score;
      }
      return `<div class="objective-chip ${current >= obj.target ? 'done' : ''}"><span class="objective-icon">${icon}</span> ${obj.label} <span class="objective-count">${current} / ${obj.target}</span></div>`;
    });
    container.innerHTML = items.join('');
  }

  // ---- オートセーブ ----
  saveGame() {
    try {
      const data = {
        version: 1,
        stageIndex: this.currentStageIndex,
        score: this.score,
        movesLeft: this.movesLeft,
        stageProgress: this.stageProgress,
        pendingFresh: false,
        grid: this.grid.map(row => row.map(tile => {
          if (!tile) return null;
          if (tile.isToken) return { type: 'token' };
          if (tile.isCrate) return { type: 'crate', crateId: tile.def.id, hp: tile.hp };
          return { type: 'tile', defId: tile.def.id, specialId: tile.specialId || null, frozen: tile.isFrozen ? 1 : 0, changer: tile.isChanger ? 1 : 0, flip: tile.isFlip ? tile.flipForm : 0 };
        }))
      };
      localStorage.setItem(RoyalMatchGame.SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* 保存失敗は無視 */ }
  }

  markPendingFresh(stageIndex) {
    try {
      const data = {
        version: 1,
        stageIndex,
        score: 0,
        movesLeft: this.stages[stageIndex].moves,
        stageProgress: { collectedSuits: {}, specialUsedCount: 0, cratesDestroyed: 0, tokensDropped: 0, thawedCount: 0, comboCount: 0 },
        pendingFresh: true,
        grid: null
      };
      localStorage.setItem(RoyalMatchGame.SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* 保存失敗は無視 */ }
  }

  clearSave() {
    try { localStorage.removeItem(RoyalMatchGame.SAVE_KEY); } catch (e) { /* 無視 */ }
  }

  tryRestoreSave() {
    let raw = null;
    try { raw = localStorage.getItem(RoyalMatchGame.SAVE_KEY); } catch (e) { /* 無視 */ }
    if (!raw) return false;
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { return false; }
    if (!data || typeof data.stageIndex !== 'number') return false;
    if (data.stageIndex < 0 || data.stageIndex >= this.stages.length) return false;

    if (data.pendingFresh || !Array.isArray(data.grid)) {
      this.loadStage(data.stageIndex);
      return true;
    }

    const stage = this.stages[data.stageIndex];
    this.currentStageIndex = data.stageIndex;
    this.clearSelection();
    this.tileLayer.innerHTML = '';
    this.fxLayer.innerHTML = '';
    this.hintLayer.innerHTML = '';
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    this.score = data.score || 0;
    this.combo = 0;
    this.movesLeft = data.movesLeft ?? stage.moves;
    this.stageProgress = data.stageProgress || { collectedSuits: {}, specialUsedCount: 0, cratesDestroyed: 0, tokensDropped: 0, thawedCount: 0, comboCount: 0 };
    if (typeof this.stageProgress.comboCount !== 'number') this.stageProgress.comboCount = 0;
    if (typeof this.stageProgress.thawedCount !== 'number') this.stageProgress.thawedCount = 0;
    this.lastSwappedCells = [];
    this.stageActionType = null;
    this.hideOverlay();

    this.setHoleMap(stage.holeMap || null);
    this.setPartitionMap(stage.partitionMap || null);
    this.setPartitionHMap(stage.partitionHMap || null);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = data.grid[r]?.[c];
        if (!cell) continue;
        if (cell.type === 'token') {
          this.grid[r][c] = this.createTokenObject(r, c);
        } else if (cell.type === 'crate') {
          const crateDef = this.config.crates.find(cr => cr.id === cell.crateId);
          if (crateDef) {
            const crate = this.createCrateObject(crateDef, r, c);
            crate.hp = cell.hp ?? crate.maxHp;
            this.refreshCrateVisual(crate);
            this.grid[r][c] = crate;
          }
        } else {
          const def = this.tileMap.get(cell.defId) || this.tileDefs[0];
          this.grid[r][c] = this.createTileObject(def, r, c, r, cell.specialId || null);
          if (cell.frozen) this.setTileFrozen(this.grid[r][c]);
          if (cell.changer && !cell.specialId) this.setTileChanger(this.grid[r][c]);
          if (cell.flip && !cell.specialId) {
            this.grid[r][c].isFlip = true;
            this.grid[r][c].flipForm = cell.flip;
            this.refreshFlipVisual(this.grid[r][c]);
          }
        }
      }
    }

    this.updateHUD();
    this.updateStageObjectivesUI();
    return true;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  let gameConfig;
  try {
    const response = await fetch('gameConfig.json');
    if (!response.ok) throw new Error('config fetch failed');
    gameConfig = await response.json();
  } catch (e) {
    gameConfig = JSON.parse(JSON.stringify(DEFAULT_GAME_CONFIG));
  }
  gameConfig.stages = STAGES;
  const game = new RoyalMatchGame(gameConfig);
  window.royalMatchGame = game;
});
