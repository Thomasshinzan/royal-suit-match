/**
 * 3. スキル効果・コンボ処理・ステージ進行＆起動処理 (main.js)
 */
class RoyalMatchGame extends RoyalMatchBoard {
  constructor(configData) {
    super(configData);

    this.currentStageIndex = 0;
    this.stageProgress = { collectedSuits: {}, specialUsedCount: 0, cratesDestroyed: 0, tokensDropped: 0 };
    this.stageActionType = 'restart';

    this.stageTitleEl = document.getElementById('stage-title');
    this.stageDescEl = document.getElementById('stage-desc');
    this.objectivesListEl = document.getElementById('objectives-list');

    this.initGridBackground();
    this.bindEvents();
    if (!this.tryRestoreSave()) this.loadStage(0);
  }

  // ---- オートセーブ (localStorage) ----
  static SAVE_KEY = 'royalSuitMatchSaveV1';
  // 全クリした一番先のステージを覚えておく記録。
  // セーブ本体とは別キーにすることで、最終ステージをクリアして
  // セーブが「全クリ済み」になっても、後からステージが追加された
  // ときにその新しいステージから再開できる。
  static PROGRESS_KEY = 'royalSuitMatchProgressV1';

  readProgress() {
    try {
      const raw = localStorage.getItem(RoyalMatchGame.PROGRESS_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return null;
      if (typeof data.highestClearedStageIndex !== 'number' || data.highestClearedStageIndex < 0) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  recordStageCleared(stageIdx) {
    try {
      const prev = this.readProgress();
      const highest = Math.max(prev ? prev.highestClearedStageIndex : -1, stageIdx);
      localStorage.setItem(RoyalMatchGame.PROGRESS_KEY, JSON.stringify({
        version: 1, highestClearedStageIndex: highest
      }));
    } catch (err) {
      console.warn('クリア進捗の保存に失敗しました:', err);
    }
  }

  // 全ステージ制覇の目印だけ残す。次に開いたとき、クリア済みの
  // 次のステージがあればそこから、新しいステージがなければ
  // 最終ステージから始まる。Stage 1 へ戻るのはステージ選択
  // ボタンでの手動操作だけにする（勝手には戻らない）。
  saveAllClearedMarker() {
    try {
      localStorage.setItem(RoyalMatchGame.SAVE_KEY, JSON.stringify({
        version: 1, pendingFresh: true, stageIndex: 0, allCleared: true
      }));
    } catch (err) {
      console.warn('オートセーブに失敗しました:', err);
    }
  }

  saveGame() {
    try {
      const gridData = this.grid.map(row => row.map(tile => {
        if (!tile) return null;
        if (tile.isCrate) return { type: 'crate', hp: tile.hp };
        if (tile.isToken) return { type: 'token' };
        return { type: 'tile', defId: tile.def.id, specialId: tile.specialId || null };
      }));
      const data = {
        version: 1,
        stageIndex: this.currentStageIndex,
        score: this.score,
        moves: this.moves,
        combo: this.combo,
        stageProgress: this.stageProgress,
        grid: gridData
      };
      localStorage.setItem(RoyalMatchGame.SAVE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('オートセーブに失敗しました:', err);
    }
  }

  savePendingStage(stageIdx) {
    try {
      localStorage.setItem(RoyalMatchGame.SAVE_KEY, JSON.stringify({
        version: 1, pendingFresh: true, stageIndex: stageIdx
      }));
    } catch (err) {
      console.warn('オートセーブに失敗しました:', err);
    }
  }

  clearSave() {
    try {
      localStorage.removeItem(RoyalMatchGame.SAVE_KEY);
      localStorage.removeItem(RoyalMatchGame.PROGRESS_KEY);
    } catch (err) { /* ignore */ }
  }

  readSave() {
    try {
      const raw = localStorage.getItem(RoyalMatchGame.SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return null;
      if (typeof data.stageIndex !== 'number' || data.stageIndex < 0 || data.stageIndex >= this.stages.length) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  tryRestoreSave() {
    const save = this.readSave();
    if (!save) return false;
    if (save.pendingFresh) {
      if (save.allCleared) {
        // 全クリ済み：クリアした次のステージがあればそこから、
        // なければ最終ステージから。Stage 1 へは手動で戻る。
        const progress = this.readProgress();
        const nextIdx = (progress ? progress.highestClearedStageIndex : -1) + 1;
        if (nextIdx < this.stages.length) {
          this.loadStage(nextIdx);
        } else {
          this.loadStage(this.stages.length - 1);
          // loadStage は普通のセーブを書き込んでしまうので目印を
          // 書き戻しておく。こうしないと、最終ステージを開いた
          // 時点で目印が消えて、後から追加されたステージから
          // 再開できなくなる。
          this.saveAllClearedMarker();
        }
      } else {
        this.loadStage(save.stageIndex);
      }
      return true;
    }
    if (!Array.isArray(save.grid) || save.grid.length !== this.rows) return false;
    const stage = this.stages[save.stageIndex];
    if (!stage) return false;

    this.currentStageIndex = save.stageIndex;
    this.hideOverlay();
    this.clearSelection();
    this.tileLayer.innerHTML = '';
    this.fxLayer.innerHTML = '';
    this.score = save.score || 0;
    this.moves = typeof save.moves === 'number' ? save.moves : stage.moves;
    this.combo = save.combo || 0;
    this.isBusy = false;
    this.lastSwappedCells = [];
    this.stageProgress = save.stageProgress || { collectedSuits: {}, specialUsedCount: 0, cratesDestroyed: 0, tokensDropped: 0 };
    if (typeof this.stageProgress.tokensDropped !== 'number') this.stageProgress.tokensDropped = 0;
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    this.setHoleMap(stage.holeMap || null);
    this.setPartitionMap(stage.partitionMap || null);

    for (let r = 0; r < this.rows; r++) {
      if (!Array.isArray(save.grid[r]) || save.grid[r].length !== this.cols) return false;
      for (let c = 0; c < this.cols; c++) {
        const cell = save.grid[r][c];
        if (!cell) continue;
        if (this.isHoleCell(r, c)) return false;
        if (cell.type === 'crate') {
          this.grid[r][c] = this.createCrateObject(r, c, cell.hp || 1);
        } else if (cell.type === 'token') {
          this.grid[r][c] = this.createTokenObject(r, c);
        } else if (cell.type === 'tile') {
          const def = this.tileMap.get(cell.defId);
          if (!def) return false;
          this.grid[r][c] = this.createTileObject(def, r, c, r, cell.specialId || null);
        } else {
          return false;
        }
      }
    }

    this.updateHUD();
    this.updateStageObjectivesUI();
    this.ensurePlayableBoard();
    return true;
  }

  getCurrentStage() {
    return this.stages[this.currentStageIndex] || this.stages[0];
  }

  updateStageObjectivesUI() {
    const stage = this.getCurrentStage();
    if (this.stageTitleEl) this.stageTitleEl.textContent = stage.title;
    if (this.stageDescEl) this.stageDescEl.textContent = stage.description;

    const btnStage = document.getElementById('btn-stage-select');
    if (btnStage) {
      btnStage.textContent = `🚩 ステージ: ${stage.stageNumber} / ${this.stages.length}`;
    }

    if (!this.objectivesListEl) return;
    this.objectivesListEl.innerHTML = stage.objectives.map(obj => {
      let currentVal = 0;
      let iconHtml = '🎯';

      if (obj.type === 'collect_suit') {
        currentVal = this.stageProgress.collectedSuits[obj.suitId] || 0;
        const suitDef = this.tileMap.get(obj.suitId);
        if (suitDef) {
          iconHtml = `<span class="objective-suit-badge ${suitDef.cssClass}"><span class="card-suit" style="font-size:0.85rem;">${suitDef.symbol}</span></span>`;
        }
      } else if (obj.type === 'score') {
        currentVal = this.score;
        iconHtml = '🏆';
      } else if (obj.type === 'use_special') {
        currentVal = this.stageProgress.specialUsedCount;
        iconHtml = '🃏';
      } else if (obj.type === 'destroy_crates') {
        currentVal = this.stageProgress.cratesDestroyed;
        iconHtml = '📦';
      } else if (obj.type === 'drop_token') {
        currentVal = this.stageProgress.tokensDropped || 0;
        iconHtml = '👑';
      }

      const isDone = currentVal >= obj.target;
      const progressText = isDone
        ? 'CLEAR ✓'
        : `${Math.min(currentVal, obj.target).toLocaleString()} / ${obj.target.toLocaleString()}`;

      return `
        <div class="objective-chip ${isDone ? 'completed' : ''}">
          <span class="objective-icon-label">${iconHtml}<span>${obj.label}</span></span>
          <span class="objective-progress">${progressText}</span>
        </div>
      `;
    }).join('');
  }

  isStageCleared() {
    const stage = this.getCurrentStage();
    return stage.objectives.every(obj => {
      if (obj.type === 'collect_suit') return (this.stageProgress.collectedSuits[obj.suitId] || 0) >= obj.target;
      if (obj.type === 'score') return this.score >= obj.target;
      if (obj.type === 'use_special') return this.stageProgress.specialUsedCount >= obj.target;
      if (obj.type === 'destroy_crates') return this.stageProgress.cratesDestroyed >= obj.target;
      if (obj.type === 'drop_token') return (this.stageProgress.tokensDropped || 0) >= obj.target;
      return false;
    });
  }

  recordRemovedTileProgress(tile) {
    if (!tile || tile.isCrate) return;
    const id = tile.def.id;
    this.stageProgress.collectedSuits[id] = (this.stageProgress.collectedSuits[id] || 0) + 1;
  }

  recordSpecialUsedProgress(count = 1) {
    this.stageProgress.specialUsedCount += count;
  }

  recordTokenDroppedProgress(count = 1) {
    this.stageProgress.tokensDropped = (this.stageProgress.tokensDropped || 0) + count;
  }

  recordCrateDestroyedProgress(count = 1) {
    this.stageProgress.cratesDestroyed += count;
  }

  evaluateStageEndState() {
    this.updateStageObjectivesUI();

    if (this.isStageCleared()) {
      // クリア済みの盤面を復元させない：次ステージへ進む場合は次ステージを新規で開く目印だけ残す
      this.recordStageCleared(this.currentStageIndex);
      if (this.currentStageIndex + 1 < this.stages.length) this.savePendingStage(this.currentStageIndex + 1);
      else this.saveAllClearedMarker();
      this.sound.playStageClear();
      const stage = this.getCurrentStage();
      const hasNextStage = this.currentStageIndex + 1 < this.stages.length;

      if (hasNextStage) {
        this.stageActionType = 'next';
        if (this.overlayBtn) this.overlayBtn.textContent = `▶ STAGE ${stage.stageNumber + 1} へ進む`;
        this.showOverlay(
          `STAGE ${stage.stageNumber} CLEAR!`,
          `おめでとうございます！クリア条件を達成しました！\n獲得スコア: ${this.score.toLocaleString()} pts`
        );
      } else {
        this.stageActionType = 'restart_all';
        if (this.overlayBtn) this.overlayBtn.textContent = '↻ STAGE 1 からもう一度プレイ';
        this.showOverlay(
          'ALL STAGES CLEAR! 🎉',
          `全ステージ制覇おめでとうございます！\n最終スコア: ${this.score.toLocaleString()} pts`
        );
      }
      return true;
    }

    if (this.moves <= 0) {
      const stage = this.getCurrentStage();
      this.savePendingStage(this.currentStageIndex);
      this.stageActionType = 'restart';
      if (this.overlayBtn) this.overlayBtn.textContent = `↻ STAGE ${stage.stageNumber} に再挑戦`;
      this.showOverlay(
        'STAGE FAILED...',
        `手数がなくなりました。クリア条件まであと少し！\nスコア: ${this.score.toLocaleString()} pts`
      );
      return true;
    }

    this.saveGame();
    return false;
  }

  bindEvents() {
    this.boardContainer.addEventListener('pointerdown', (e) => {
      if (this.isBusy || this.overlay.classList.contains('active')) return;
      const cell = this.getCellFromEvent(e);
      if (!cell) return;
      this.dragStart = { x: e.clientX, y: e.clientY, cell, swiped: false };
    });

    this.boardContainer.addEventListener('pointermove', (e) => {
      if (!this.dragStart || this.dragStart.swiped || this.isBusy) return;
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
        if (this.isValidCell(targetR, targetC) && !this.isCrateCell(origin.r, origin.c) && !this.isCrateCell(targetR, targetC) && !this.isHoleCell(origin.r, origin.c) && !this.isHoleCell(targetR, targetC)) {
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
      btnSound.textContent = isMuted ? '🔇 音: OFF' : '🔊 音: ON';
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
      else if (this.stageActionType === 'restart_all') this.loadStage(0);
      else this.loadStage(this.currentStageIndex);
    });
  }

  async handleCellTap(cell) {
    const tappedTile = this.grid[cell.r]?.[cell.c];
    if (!tappedTile || tappedTile.isCrate) return;

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

  isTapActivatableSpecial(tile) {
    if (!tile?.specialId) return false;
    return Boolean(this.specialMap.get(tile.specialId)?.tapActivatable);
  }

  async activateSingleSpecialByTap(r, c) {
    const tile = this.grid[r]?.[c];
    if (!tile || !tile.specialId) return;

    this.isBusy = true;
    this.moves = Math.max(0, this.moves - 1);
    this.combo = 1;
    this.updateHUD();

    const trigger = { r, c, specialId: tile.specialId, swappedWithSuitId: null };
    await this.triggerSpecialActivationsAndCascade([trigger]);

    if (!this.evaluateStageEndState()) {
      await this.ensurePlayableBoard();
    }
    this.isBusy = false;
  }

  loadStage(stageIdx) {
    this.currentStageIndex = Math.max(0, Math.min(stageIdx, this.stages.length - 1));
    const stage = this.getCurrentStage();

    this.hideOverlay();
    this.clearSelection();
    this.tileLayer.innerHTML = '';
    this.fxLayer.innerHTML = '';

    this.score = 0;
    this.moves = stage.moves;
    this.combo = 0;
    this.isBusy = false;
    this.lastSwappedCells = [];
    this.stageProgress = { collectedSuits: {}, specialUsedCount: 0, cratesDestroyed: 0, tokensDropped: 0 };
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
    const crateMap = stage.crateMap || null;
    const tokenMap = stage.tokenMap || null;
    this.setHoleMap(stage.holeMap || null);
    this.setPartitionMap(stage.partitionMap || null);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isHoleCell(r, c)) continue;
        const crateHp = crateMap?.[r]?.[c] || 0;
        if (crateHp > 0) {
          this.grid[r][c] = this.createCrateObject(r, c, crateHp);
          continue;
        }
        if (tokenMap?.[r]?.[c]) {
          this.grid[r][c] = this.createTokenObject(r, c);
          continue;
        }

        const forbiddenIds = new Set();
        if (c >= 2 && !this.isHoleCell(r, c - 1) && !this.isHoleCell(r, c - 2) && !this.grid[r][c - 1]?.isCrate && !this.grid[r][c - 2]?.isCrate &&
            this.grid[r][c - 1]?.def.id === this.grid[r][c - 2]?.def.id) {
          forbiddenIds.add(this.grid[r][c - 1].def.id);
        }
        if (r >= 2 && !this.isHoleCell(r - 1, c) && !this.isHoleCell(r - 2, c) && !this.grid[r - 1][c]?.isCrate && !this.grid[r - 2][c]?.isCrate &&
            this.grid[r - 1][c]?.def.id === this.grid[r - 2][c]?.def.id) {
          forbiddenIds.add(this.grid[r - 1][c].def.id);
        }
        const def = this.getRandomTileDef(forbiddenIds);
        this.grid[r][c] = this.createTileObject(def, r, c, r);
      }
    }

    this.ensurePlayableBoard();
    this.updateHUD();
    this.updateStageObjectivesUI();
    this.saveGame();
  }

  async attemptSwap(posA, posB) {
    if (this.isCrateCell(posA.r, posA.c) || this.isCrateCell(posB.r, posB.c) || this.isHoleCell(posA.r, posA.c) || this.isHoleCell(posB.r, posB.c) || this.hasPartitionBetween(posA, posB)) return;
    this.isBusy = true;
    this.sound.playSwap();

    const tileBeforeA = this.grid[posA.r][posA.c];
    const tileBeforeB = this.grid[posB.r][posB.c];
    const isSpecialA = Boolean(tileBeforeA?.specialId);
    const isSpecialB = Boolean(tileBeforeB?.specialId);

    this.swapTilesInGrid(posA, posB);
    await this.sleep(this.config.timingsMs.swap);

    const movedA = this.grid[posB.r][posB.c];
    const movedB = this.grid[posA.r][posA.c];

    if (isSpecialA && isSpecialB) {
      this.moves = Math.max(0, this.moves - 1);
      this.combo = 1;
      this.updateHUD();

      await this.executeSpecialPairCombo(
        { r: posB.r, c: posB.c, tile: movedA },
        { r: posA.r, c: posA.c, tile: movedB }
      );

      if (!this.evaluateStageEndState()) {
        await this.ensurePlayableBoard();
      }
      this.isBusy = false;
      return;
    }

    if (isSpecialA || isSpecialB) {
      this.moves = Math.max(0, this.moves - 1);
      this.combo = 1;
      this.updateHUD();

      const initialTriggers = [];
      if (movedA?.specialId) {
        initialTriggers.push({ r: posB.r, c: posB.c, specialId: movedA.specialId, swappedWithSuitId: movedB?.isToken ? null : (movedB?.def.id || null) });
      }
      if (movedB?.specialId) {
        initialTriggers.push({ r: posA.r, c: posA.c, specialId: movedB.specialId, swappedWithSuitId: movedA?.isToken ? null : (movedA?.def.id || null) });
      }

      const simultaneousMatches = this.findAllMatches();
      await this.triggerSpecialActivationsAndCascade(initialTriggers, simultaneousMatches);

      if (!this.evaluateStageEndState()) {
        await this.ensurePlayableBoard();
      }
      this.isBusy = false;
      return;
    }

    const matchData = this.findAllMatches();
    if (matchData.cells.length === 0) {
      this.sound.playInvalid();
      this.swapTilesInGrid(posA, posB);
      await this.sleep(this.config.timingsMs.swap);
      this.isBusy = false;
      return;
    }

    this.lastSwappedCells = [posA, posB];
    this.moves = Math.max(0, this.moves - 1);
    this.combo = 0;
    this.updateHUD();

    await this.resolveCascadeLoop(matchData);
    this.lastSwappedCells = [];

    if (!this.evaluateStageEndState()) {
      await this.ensurePlayableBoard();
    }

    this.isBusy = false;
  }

  async executeSpecialPairCombo(primary, secondary) {
    const rank1 = this.specialMap.get(primary.tile.specialId)?.rank;
    const rank2 = this.specialMap.get(secondary.tile.specialId)?.rank;
    const ranks = [rank1, rank2];

    const destroySet = new Set();
    const preservedKeys = new Set();
    const chainQueue = [];
    const activatedKeys = new Set([`${primary.r},${primary.c}`, `${secondary.r},${secondary.c}`]);

    let comboTitle = 'SPECIAL COMBO';
    let comboColor = '#fbbf24';
    let comboBonus = 1000;
    let rectOverlayBounds = null;
    const beams = [];

    const addCellToDestroy = (r, c) => {
      if (!this.isValidCell(r, c) || !this.grid[r][c]) return;
      const key = `${r},${c}`;
      if (preservedKeys.has(key)) return;
      destroySet.add(key);

      const t = this.grid[r][c];
      if (!t.isCrate && t?.specialId && !activatedKeys.has(key)) {
        chainQueue.push({ r, c, specialId: t.specialId, swappedWithSuitId: null });
      }
    };

    const collect28RectAroundPair = () => {
      const minR = Math.min(primary.r, secondary.r);
      const maxR = Math.max(primary.r, secondary.r);
      const minC = Math.min(primary.c, secondary.c);
      const maxC = Math.max(primary.c, secondary.c);

      const startR = Math.max(0, minR - 2);
      const endR = Math.min(this.rows - 1, maxR + 2);
      const startC = Math.max(0, minC - 2);
      const endC = Math.min(this.cols - 1, maxC + 2);

      rectOverlayBounds = { startR, endR, startC, endC };
      for (let r = startR; r <= endR; r++) {
        for (let c = startC; c <= endC; c++) addCellToDestroy(r, c);
      }
    };

    if (rank1 === 'A' && rank2 === 'A') {
      comboTitle = 'GRAND FLUSH 全消去！';
      comboColor = '#fb7185';
      comboBonus = 3000;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) addCellToDestroy(r, c);
      }
    } else if (ranks.includes('A')) {
      comboTitle = '2種類全消去！';
      comboColor = '#f43f5e';
      comboBonus = 1800;

      addCellToDestroy(primary.r, primary.c);
      addCellToDestroy(secondary.r, secondary.c);

      const availableSuits = new Set();
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const t = this.grid[r][c];
          if (t && !t.isCrate && !activatedKeys.has(`${r},${c}`)) availableSuits.add(t.def.id);
        }
      }
      const chosenSuits = new Set(this.pickRandomSubset(Array.from(availableSuits), 2));
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const t = this.grid[r][c];
          if (t && !t.isCrate && chosenSuits.has(t.def.id)) addCellToDestroy(r, c);
        }
      }
    } else if (rank1 === 'J' && rank2 === 'J') {
      comboTitle = 'MEGA BLAST 周囲28消去！';
      comboColor = '#38bdf8';
      comboBonus = 800;
      collect28RectAroundPair();
    } else if (ranks.includes('J') && (ranks.includes('Q') || ranks.includes('K'))) {
      const qOrK = (rank1 === 'Q' || rank1 === 'K') ? primary : secondary;
      const keptRank = rank1 === 'J' ? rank2 : rank1;
      const keptKey = `${qOrK.r},${qOrK.c}`;

      comboTitle = '周囲28消去＆矢印残存！';
      comboColor = keptRank === 'Q' ? '#fbbf24' : '#c084fc';
      comboBonus = 1000;

      preservedKeys.add(keptKey);
      collect28RectAroundPair();
    } else if (rank1 === 'Q' && rank2 === 'Q') {
      comboTitle = '縦3列一掃！';
      comboColor = '#fbbf24';
      comboBonus = 1200;

      const baseCol = primary.c;
      for (let dc = -1; dc <= 1; dc++) {
        const col = baseCol + dc;
        if (col >= 0 && col < this.cols) {
          beams.push({ type: 'vertical', index: col, styleClass: '' });
          for (let r = 0; r < this.rows; r++) addCellToDestroy(r, col);
        }
      }
      addCellToDestroy(secondary.r, secondary.c);
    } else if (rank1 === 'K' && rank2 === 'K') {
      comboTitle = '横3行一掃！';
      comboColor = '#c084fc';
      comboBonus = 1200;

      const baseRow = primary.r;
      for (let dr = -1; dr <= 1; dr++) {
        const row = baseRow + dr;
        if (row >= 0 && row < this.rows) {
          beams.push({ type: 'horizontal', index: row, styleClass: 'king' });
          for (let c = 0; c < this.cols; c++) addCellToDestroy(row, c);
        }
      }
      addCellToDestroy(secondary.r, secondary.c);
    } else if ((rank1 === 'Q' && rank2 === 'K') || (rank1 === 'K' && rank2 === 'Q')) {
      const qNode = rank1 === 'Q' ? primary : secondary;
      const kNode = rank1 === 'K' ? primary : secondary;

      comboTitle = 'ROYAL 3-LINE CROSS！';
      comboColor = '#f59e0b';
      comboBonus = 1400;

      const targetCols = Array.from(new Set([qNode.c, kNode.c]));
      const targetRows = Array.from(new Set([qNode.r, kNode.r]));

      for (const col of targetCols) {
        beams.push({ type: 'vertical', index: col, styleClass: '' });
        for (let r = 0; r < this.rows; r++) addCellToDestroy(r, col);
      }
      for (const row of targetRows) {
        beams.push({ type: 'horizontal', index: row, styleClass: 'king' });
        for (let c = 0; c < this.cols; c++) addCellToDestroy(row, c);
      }
    }

    for (const node of [primary, secondary]) {
      const k = `${node.r},${node.c}`;
      if (!preservedKeys.has(k)) node.tile.el.classList.add('skill-activating');
      else node.tile.el.classList.add('combo-preserved');
    }

    const chainedVisuals = [];
    while (chainQueue.length > 0) {
      const trig = chainQueue.shift();
      const tKey = `${trig.r},${trig.c}`;
      if (activatedKeys.has(tKey) || preservedKeys.has(tKey)) continue;
      activatedKeys.add(tKey);
      destroySet.add(tKey);

      const effect = this.computeSingleSkillEffect(trig, destroySet);
      chainedVisuals.push(effect);
      for (const target of effect.targets) {
        const k = `${target.r},${target.c}`;
        if (preservedKeys.has(k)) continue;
        destroySet.add(k);
        const tTile = this.grid[target.r]?.[target.c];
        if (tTile?.specialId && !activatedKeys.has(k)) {
          chainQueue.push({ r: target.r, c: target.c, specialId: tTile.specialId, swappedWithSuitId: null });
        }
      }
    }

    this.sound.playSkill('combo');
    this.recordSpecialUsedProgress(2 + chainedVisuals.length);
    this.playComboSpecialVisuals(comboTitle, comboColor, beams, rectOverlayBounds, destroySet, preservedKeys);
    if (chainedVisuals.length > 0) this.playSkillEffects(chainedVisuals, false);

    await this.sleep(280);

    const cellsToRemove = Array.from(destroySet)
      .filter(k => !preservedKeys.has(k))
      .map(k => {
        const [r, c] = k.split(',').map(Number);
        return { r, c };
      });

    const crateTargets = cellsToRemove.filter(({ r, c }) => this.isCrateCell(r, c));
    const cardTargets = cellsToRemove.filter(({ r, c }) => !this.isCrateCell(r, c) && !this.isTokenCell(r, c));

    let roundPoints = comboBonus;
    for (const { r, c } of cardTargets) {
      const tile = this.grid[r][c];
      if (!tile) continue;
      roundPoints += Math.round(this.config.baseMatchScore * tile.def.scoreWeight);
      if (!tile.el.classList.contains('skill-activating')) tile.el.classList.add('matched');
      this.spawnSparkles(r, c);
    }

    const destroyedCrates = this.damageCratesAtCells(crateTargets);
    roundPoints += destroyedCrates * 150;

    this.score += roundPoints;
    this.updateHUD(true);
    this.spawnFloatingScore(primary.r, primary.c, roundPoints, 2);

    await this.sleep(this.config.timingsMs.matchPop);

    for (const { r, c } of cardTargets) {
      const tile = this.grid[r][c];
      if (tile) {
        this.recordRemovedTileProgress(tile);
        tile.el.remove();
        this.grid[r][c] = null;
      }
    }
    this.updateStageObjectivesUI();

    for (const key of preservedKeys) {
      const [pr, pc] = key.split(',').map(Number);
      this.grid[pr]?.[pc]?.el.classList.remove('combo-preserved');
    }

    await this.applyGravityAndRefill();
    await this.collectDroppedTokensAndRefill();
    const nextMatches = this.findAllMatches();
    if (nextMatches.cells.length > 0) {
      await this.resolveCascadeLoop(nextMatches);
    }
  }

  playComboSpecialVisuals(title, color, beams, rectBounds, destroySet, preservedKeys) {
    const cellSpan = 100 / this.cols;

    const banner = document.createElement('div');
    banner.className = 'skill-cutin-banner';
    banner.style.setProperty('--skill-color', color);
    banner.innerHTML = `
      <span class="skill-cutin-badge">COMBO</span>
      <span class="skill-cutin-text">${title}</span>
    `;
    this.fxLayer.appendChild(banner);
    setTimeout(() => banner.remove(), 1400);

    if (rectBounds) {
      const zone = document.createElement('div');
      zone.className = 'combo-rect-zone';
      zone.style.left = `${rectBounds.startC * cellSpan}%`;
      zone.style.top = `${rectBounds.startR * cellSpan}%`;
      zone.style.width = `${(rectBounds.endC - rectBounds.startC + 1) * cellSpan}%`;
      zone.style.height = `${(rectBounds.endR - rectBounds.startR + 1) * cellSpan}%`;
      this.fxLayer.appendChild(zone);
      setTimeout(() => zone.remove(), 520);
    }

    for (const b of beams) {
      const beam = document.createElement('div');
      if (b.type === 'horizontal') {
        beam.className = `skill-beam ${b.styleClass || ''}`;
        beam.style.left = '0%';
        beam.style.width = '100%';
        beam.style.top = `${(b.index + 0.2) * cellSpan}%`;
        beam.style.height = `${cellSpan * 0.6}%`;
      } else {
        beam.className = `skill-beam vertical ${b.styleClass || ''}`;
        beam.style.top = '0%';
        beam.style.height = '100%';
        beam.style.left = `${(b.index + 0.2) * cellSpan}%`;
        beam.style.width = `${cellSpan * 0.6}%`;
      }
      this.fxLayer.appendChild(beam);
      setTimeout(() => beam.remove(), 500);
    }

    for (const key of destroySet) {
      if (preservedKeys.has(key)) continue;
      const [r, c] = key.split(',').map(Number);
      const tile = this.grid[r]?.[c];
      if (tile && !tile.el.classList.contains('skill-activating')) {
        tile.el.classList.add('skill-targeted');
      }
    }
  }

  planSpecialCardSpawns(groups) {
    const spawnPlans = [];
    const protectedKeys = new Set();

    const pickPivotCell = (cells) => {
      for (const sw of this.lastSwappedCells) {
        const found = cells.find(cell => cell.r === sw.r && cell.c === sw.c);
        if (found) return found;
      }
      return cells[Math.floor(cells.length / 2)];
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
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            const t = this.grid[row][col];
            if (t && !t.isCrate && !t.isToken && !(row === r && col === c)) presentSuits.add(t.def.id);
          }
        }
        const arr = Array.from(presentSuits);
        targetSuit = arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null;
      }

      if (targetSuit) {
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            if (canHit(row, col) && !this.isCrateCell(row, col) && this.grid[row][col]?.def.id === targetSuit) {
              affectedCells.push({ r: row, c: col });
            }
          }
        }
      }
    }

    return { skill: skillDef, pivot: { r, c }, orientation, targets: affectedCells };
  }

  async triggerSpecialActivationsAndCascade(initialTriggers, simultaneousMatchData = { cells: [], groups: [] }) {
    const destroySet = new Set();
    const triggeredVisuals = [];
    const queue = [...initialTriggers];
    const activatedKeys = new Set();

    for (const cell of simultaneousMatchData.cells) {
      const key = `${cell.r},${cell.c}`;
      destroySet.add(key);
      const t = this.grid[cell.r]?.[cell.c];
      if (t?.specialId && !activatedKeys.has(key)) {
        queue.push({ r: cell.r, c: cell.c, specialId: t.specialId, swappedWithSuitId: null });
      }
    }

    while (queue.length > 0) {
      const current = queue.shift();
      const key = `${current.r},${current.c}`;
      if (activatedKeys.has(key)) continue;
      activatedKeys.add(key);
      destroySet.add(key);

      const originTile = this.grid[current.r]?.[current.c];
      if (originTile) originTile.el.classList.add('skill-activating');

      const effect = this.computeSingleSkillEffect(current, destroySet);
      triggeredVisuals.push(effect);

      for (const target of effect.targets) {
        const tKey = `${target.r},${target.c}`;
        destroySet.add(tKey);
        const targetTile = this.grid[target.r]?.[target.c];
        if (targetTile?.specialId && !activatedKeys.has(tKey)) {
          queue.push({ r: target.r, c: target.c, specialId: targetTile.specialId, swappedWithSuitId: null });
        }
      }
    }

    this.playSkillEffects(triggeredVisuals, true);
    this.recordSpecialUsedProgress(triggeredVisuals.length);
    await this.sleep(240);

    const allDestroyCells = Array.from(destroySet).map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    });

    const crateTargets = allDestroyCells.filter(({ r, c }) => this.isCrateCell(r, c));
    const cardTargets = allDestroyCells.filter(({ r, c }) => !this.isCrateCell(r, c) && !this.isTokenCell(r, c));

    let roundPoints = 0;
    let centerR = 0;
    let centerC = 0;

    for (const { r, c } of cardTargets) {
      const tile = this.grid[r][c];
      if (!tile) continue;
      roundPoints += Math.round(this.config.baseMatchScore * tile.def.scoreWeight);
      centerR += r;
      centerC += c;
      if (!tile.el.classList.contains('skill-activating')) tile.el.classList.add('matched');
      this.spawnSparkles(r, c);
    }

    const destroyedCrates = this.damageCratesAtCells(crateTargets);
    roundPoints += destroyedCrates * 150;

    for (const vis of triggeredVisuals) {
      if (vis.skill?.bonusScore) roundPoints += vis.skill.bonusScore;
    }

    this.score += roundPoints;
    this.updateHUD(true);

    if (cardTargets.length > 0) {
      this.spawnFloatingScore(
        centerR / cardTargets.length,
        centerC / cardTargets.length,
        roundPoints,
        triggeredVisuals.length > 1 ? triggeredVisuals.length : 1
      );
    }

    await this.sleep(this.config.timingsMs.matchPop);

    for (const { r, c } of cardTargets) {
      const tile = this.grid[r][c];
      if (tile) {
        this.recordRemovedTileProgress(tile);
        tile.el.remove();
        this.grid[r][c] = null;
      }
    }
    this.updateStageObjectivesUI();

    await this.applyGravityAndRefill();
    await this.collectDroppedTokensAndRefill();
    const nextMatches = this.findAllMatches();
    if (nextMatches.cells.length > 0) {
      await this.resolveCascadeLoop(nextMatches);
    }
  }

  playSkillEffects(triggeredSkills, showCutin = true) {
    const cellSpan = 100 / this.cols;

    triggeredSkills.forEach((entry, idx) => {
      const { skill, pivot, orientation, targets } = entry;
      if (!skill) return;

      if (idx === 0 && showCutin) this.sound.playSkill(skill.id);

      if (showCutin && idx < 3) {
        const banner = document.createElement('div');
        banner.className = 'skill-cutin-banner';
        banner.style.setProperty('--skill-color', skill.color);
        banner.style.top = `${10 + idx * 11}%`;
        banner.innerHTML = `
          <span class="skill-cutin-badge">${skill.icon}</span>
          <span class="skill-cutin-text">${skill.name} 発動！</span>
        `;
        this.fxLayer.appendChild(banner);
        setTimeout(() => banner.remove(), 1300);
      }

      if (orientation === 'horizontal') {
        const beamH = document.createElement('div');
        beamH.className = 'skill-beam king';
        beamH.style.left = '0%';
        beamH.style.width = '100%';
        beamH.style.top = `${(pivot.r + 0.25) * cellSpan}%`;
        beamH.style.height = `${cellSpan * 0.5}%`;
        this.fxLayer.appendChild(beamH);
        setTimeout(() => beamH.remove(), 480);
      }

      if (orientation === 'vertical') {
        const beamV = document.createElement('div');
        beamV.className = 'skill-beam vertical';
        beamV.style.top = '0%';
        beamV.style.height = '100%';
        beamV.style.left = `${(pivot.c + 0.25) * cellSpan}%`;
        beamV.style.width = `${cellSpan * 0.5}%`;
        this.fxLayer.appendChild(beamV);
        setTimeout(() => beamV.remove(), 480);
      }

      if (targets && targets.length > 0) {
        for (const t of targets) {
          const tile = this.grid[t.r]?.[t.c];
          if (tile && !tile.el.classList.contains('skill-activating')) {
            tile.el.classList.add('skill-targeted');
          }
        }
      }
    });
  }

  async resolveCascadeLoop(initialMatchData) {
    let currentMatchData = initialMatchData;

    while (currentMatchData.cells.length > 0) {
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
        else if (!this.isTokenCell(cell.r, cell.c)) cardTargets.push(cell);
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
        const tile = this.grid[r][c];
        if (tile) {
          this.recordRemovedTileProgress(tile);
          tile.el.remove();
          this.grid[r][c] = null;
        }
      }
      this.updateStageObjectivesUI();

      for (const plan of spawnPlans) {
        const tile = this.grid[plan.r]?.[plan.c];
        if (tile) {
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
}

window.addEventListener('DOMContentLoaded', async () => {
  let gameConfig = DEFAULT_GAME_CONFIG;

  try {
    const response = await fetch('gameConfig.json');
    if (response.ok) {
      gameConfig = await response.json();
    }
  } catch (err) {
    console.warn('外部 gameConfig.json の取得をスキップし、内蔵フォールバック設定を使用します:', err);
  }

  try {
    window.royalMatchApp = new RoyalMatchGame(gameConfig);
  } catch (err) {
    console.error('ゲームの初期化に失敗しました:', err);
  }
});