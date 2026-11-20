/**
 * 2. 盤面操作・木箱ギミック・マッチ検出・重力落下エンジン (boardLogic.js)
 */
class RoyalMatchBoard {
  constructor(configData) {
    this.config = configData.boardConfig;
    this.tileDefs = configData.tiles;
    this.specialDefs = configData.specialCards || [];
    this.stages = configData.stages || DEFAULT_GAME_CONFIG.stages;

    this.tileMap = new Map(this.tileDefs.map(t => [t.id, t]));
    this.specialMap = new Map(this.specialDefs.map(s => [s.id, s]));

    this.rows = this.config.rows;
    this.cols = this.config.cols;

    this.grid = [];
    this.holeSet = new Set();
    this.score = 0;
    this.moves = this.config.initialMoves;
    this.combo = 0;
    this.isBusy = false;
    this.selectedCell = null;
    this.lastSwappedCells = [];
    this.nextTileUid = 1;
    this.dragStart = null;

    this.boardContainer = document.getElementById('board-container');
    this.gridBg = document.getElementById('grid-bg');
    this.tileLayer = document.getElementById('tile-layer');
    this.fxLayer = document.getElementById('fx-layer');
    this.overlay = document.getElementById('board-overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlaySub = document.getElementById('overlay-sub');
    this.overlayBtn = document.getElementById('btn-overlay-restart');

    this.hudScore = document.getElementById('hud-score');
    this.hudMoves = document.getElementById('hud-moves');
    this.hudModeLabel = document.getElementById('hud-mode-label');
    this.hudCombo = document.getElementById('hud-combo');

    this.sound = new SoundEngine();
  }

  initGridBackground() {
    this.gridBg.innerHTML = '';
    for (let i = 0; i < this.rows * this.cols; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      this.gridBg.appendChild(cell);
    }
    this.updateHoleBackground();
  }

  isHoleCell(r, c) {
    return this.holeSet.has(`${r},${c}`);
  }

  isBlockerCell(r, c) {
    return this.isHoleCell(r, c) || this.isCrateCell(r, c);
  }

  setHoleMap(holeMap) {
    this.holeSet = new Set();
    if (holeMap) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (holeMap[r]?.[c]) this.holeSet.add(`${r},${c}`);
        }
      }
    }
    this.updateHoleBackground();
  }

  updateHoleBackground() {
    if (!this.gridBg) return;
    Array.from(this.gridBg.children).forEach((cell, i) => {
      const r = Math.floor(i / this.cols);
      const c = i % this.cols;
      cell.classList.toggle('hole-cell', this.isHoleCell(r, c));
    });
  }

  isCrateCell(r, c) {
    return Boolean(this.grid[r]?.[c]?.isCrate);
  }

  createCrateObject(row, col, hp = 1) {
    const uid = this.nextTileUid++;
    const el = document.createElement('div');
    el.className = `card-tile crate-tile hp-${hp}`;
    el.dataset.uid = uid;
    el.innerHTML = `<span class="card-suit" style="font-size:1.55rem;">📦</span>`;

    const crateObj = {
      uid,
      isCrate: true,
      hp,
      def: { id: 'crate', name: '木箱', scoreWeight: 1.5 },
      specialId: null,
      row,
      col,
      el
    };

    this.applyTileCoordinates(el, row, col);
    this.tileLayer.appendChild(el);
    return crateObj;
  }

  damageCratesAtCells(crateCoords) {
    let destroyedCount = 0;
    let damagedAny = false;

    for (const { r, c } of crateCoords) {
      const tile = this.grid[r]?.[c];
      if (!tile || !tile.isCrate) continue;

      damagedAny = true;
      tile.hp -= 1;
      this.spawnSparkles(r, c);

      if (tile.hp <= 0) {
        destroyedCount++;
        if (this.recordCrateDestroyedProgress) this.recordCrateDestroyedProgress(1);
        tile.el.classList.add('matched');
        const elRef = tile.el;
        setTimeout(() => elRef.remove(), this.config.timingsMs.matchPop);
        this.grid[r][c] = null;
      } else {
        tile.el.classList.remove('hp-2', 'damaged');
        tile.el.classList.add('hp-1', 'damaged');
      }
    }

    if (damagedAny) {
      this.sound.playCrateHit(destroyedCount > 0);
      if (this.updateStageObjectivesUI) this.updateStageObjectivesUI();
    }
    return destroyedCount;
  }

  getRandomTileDef(forbiddenIds = new Set()) {
    const candidates = this.tileDefs.filter(t => !forbiddenIds.has(t.id));
    const pool = candidates.length > 0 ? candidates : this.tileDefs;
    const totalWeight = pool.reduce((sum, t) => sum + (t.spawnWeight || 1), 0);
    let rand = Math.random() * totalWeight;
    for (const t of pool) {
      rand -= (t.spawnWeight || 1);
      if (rand <= 0) return t;
    }
    return pool[pool.length - 1];
  }

  pickRandomSubset(items, count) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
  }

  applyTileCoordinates(el, row, col) {
    const cellW = 100 / this.cols;
    const cellH = 100 / this.rows;
    el.style.width = `calc(${cellW}% - 4px)`;
    el.style.height = `calc(${cellH}% - 4px)`;
    el.style.left = `calc(${col * cellW}% + 2px)`;
    el.style.top = `calc(${row * cellH}% + 2px)`;
  }

  updateTilePosition(tile, newRow, newCol, isFalling = false) {
    if (!tile) return;
    tile.row = newRow;
    tile.col = newCol;
    tile.el.classList.toggle('falling', isFalling);
    this.applyTileCoordinates(tile.el, newRow, newCol);
  }

  createTileObject(def, targetRow, targetCol, spawnRow = targetRow, specialId = null) {
    const uid = this.nextTileUid++;
    const el = document.createElement('div');
    const specialDef = specialId ? this.specialMap.get(specialId) : null;

    el.className = `card-tile ${def.cssClass}`;
    if (specialDef) {
      el.classList.add('special-card', `rank-${specialDef.rank}`);
      el.innerHTML = `<span class="special-icon-main">${specialDef.icon}</span>`;
    } else {
      el.innerHTML = `<span class="card-suit">${def.symbol}</span>`;
    }
    el.dataset.uid = uid;

    const tileObj = { uid, def, specialId, row: targetRow, col: targetCol, el };
    this.applyTileCoordinates(el, spawnRow, targetCol);
    this.tileLayer.appendChild(el);
    return tileObj;
  }

  upgradeTileToSpecial(tile, specialId) {
    const specialDef = this.specialMap.get(specialId);
    if (!tile || !specialDef) return;

    tile.specialId = specialId;
    tile.el.classList.remove('matched', 'selected', 'hint', 'rank-J', 'rank-Q', 'rank-K', 'rank-A');
    tile.el.classList.add('special-card', `rank-${specialDef.rank}`);
    tile.el.innerHTML = `<span class="special-icon-main">${specialDef.icon}</span>`;
  }

  findAllMatches() {
    const horizSet = new Set();
    const vertSet = new Set();
    const allSet = new Set();

    for (let r = 0; r < this.rows; r++) {
      let c = 0;
      while (c < this.cols) {
        const tile = this.grid[r][c];
        if (!tile || tile.isCrate) { c++; continue; }
        let end = c + 1;
        while (end < this.cols && !this.isHoleCell(r, end) && !this.grid[r][end]?.isCrate && this.grid[r][end]?.def.id === tile.def.id) end++;
        if (end - c >= this.config.minMatchLength) {
          for (let k = c; k < end; k++) {
            const key = `${r},${k}`;
            horizSet.add(key);
            allSet.add(key);
          }
        }
        c = end;
      }
    }

    for (let c = 0; c < this.cols; c++) {
      let r = 0;
      while (r < this.rows) {
        const tile = this.grid[r][c];
        if (!tile || tile.isCrate) { r++; continue; }
        let end = r + 1;
        while (end < this.rows && !this.isHoleCell(end, c) && !this.grid[end][c]?.isCrate && this.grid[end][c]?.def.id === tile.def.id) end++;
        if (end - r >= this.config.minMatchLength) {
          for (let k = r; k < end; k++) {
            const key = `${k},${c}`;
            vertSet.add(key);
            allSet.add(key);
          }
        }
        r = end;
      }
    }

    const visited = new Set();
    const groups = [];
    for (const key of allSet) {
      if (visited.has(key)) continue;
      const [sr, sc] = key.split(',').map(Number);
      const suitId = this.grid[sr][sc].def.id;
      const queue = [{ r: sr, c: sc }];
      visited.add(key);

      const groupCells = [];
      let hasHoriz = false;
      let hasVert = false;

      while (queue.length > 0) {
        const curr = queue.shift();
        const cKey = `${curr.r},${curr.c}`;
        groupCells.push(curr);
        if (horizSet.has(cKey)) hasHoriz = true;
        if (vertSet.has(cKey)) hasVert = true;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of dirs) {
          const nr = curr.r + dr;
          const nc = curr.c + dc;
          const nKey = `${nr},${nc}`;
          if (allSet.has(nKey) && !visited.has(nKey) && this.grid[nr]?.[nc]?.def.id === suitId) {
            visited.add(nKey);
            queue.push({ r: nr, c: nc });
          }
        }
      }

      groups.push({ suitId, cells: groupCells, hasHoriz, hasVert });
    }

    const cells = Array.from(allSet).map(k => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    });

    return { cells, groups };
  }

  getCellFromEvent(e) {
    const rect = this.tileLayer.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const c = Math.floor((relX / rect.width) * this.cols);
    const r = Math.floor((relY / rect.height) * this.rows);
    return this.isValidCell(r, c) ? { r, c } : null;
  }

  isValidCell(r, c) { return r >= 0 && r < this.rows && c >= 0 && c < this.cols; }
  isAdjacent(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }

  selectCell(r, c) {
    this.clearSelection();
    this.selectedCell = { r, c };
    const tile = this.grid[r][c];
    if (tile) {
      tile.el.classList.add('selected');
      this.sound.playSelect();
    }
  }

  clearSelection() {
    if (this.selectedCell) {
      const tile = this.grid[this.selectedCell.r]?.[this.selectedCell.c];
      if (tile) tile.el.classList.remove('selected');
      this.selectedCell = null;
    }
  }

  swapTilesInGrid(posA, posB) {
    const tileA = this.grid[posA.r][posA.c];
    const tileB = this.grid[posB.r][posB.c];

    this.grid[posA.r][posA.c] = tileB;
    this.grid[posB.r][posB.c] = tileA;

    this.updateTilePosition(tileB, posA.r, posA.c, false);
    this.updateTilePosition(tileA, posB.r, posB.c, false);
  }

  async applyGravityAndRefill() {
    const newTilesToDrop = [];

    for (let c = 0; c < this.cols; c++) {
      let segmentBottom = this.rows - 1;

      while (segmentBottom >= 0) {
        if (this.isBlockerCell(segmentBottom, c)) {
          segmentBottom--;
          continue;
        }

        let segmentTop = segmentBottom;
        while (segmentTop - 1 >= 0 && !this.isBlockerCell(segmentTop - 1, c)) {
          segmentTop--;
        }

        let writeRow = segmentBottom;
        for (let r = segmentBottom; r >= segmentTop; r--) {
          if (this.grid[r][c] !== null) {
            if (writeRow !== r) {
              const tile = this.grid[r][c];
              this.grid[writeRow][c] = tile;
              this.grid[r][c] = null;
              this.updateTilePosition(tile, writeRow, c, true);
            }
            writeRow--;
          }
        }

        for (let r = writeRow; r >= segmentTop; r--) {
          const def = this.getRandomTileDef();
          const spawnRow = segmentTop - (writeRow - r + 1) - 0.3;
          const newTile = this.createTileObject(def, r, c, spawnRow);
          this.grid[r][c] = newTile;
          newTilesToDrop.push({ tile: newTile, r, c });
        }

        segmentBottom = segmentTop - 1;
      }
    }

    if (newTilesToDrop.length > 0) {
      await this.sleep(25);
      for (const item of newTilesToDrop) {
        this.updateTilePosition(item.tile, item.r, item.c, true);
      }
    }

    this.sound.playDrop();
    await this.sleep(this.config.timingsMs.fall);
  }

  findValidMove() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const curr = this.grid[r][c];
        if (!curr || curr.isCrate) continue;

        if (curr.specialId) {
          if (c + 1 < this.cols && !this.isCrateCell(r, c + 1) && !this.isHoleCell(r, c + 1)) return [{ r, c }, { r, c: c + 1 }];
          if (c - 1 >= 0 && !this.isCrateCell(r, c - 1) && !this.isHoleCell(r, c - 1)) return [{ r, c }, { r, c: c - 1 }];
          if (r + 1 < this.rows && !this.isCrateCell(r + 1, c) && !this.isHoleCell(r + 1, c)) return [{ r, c }, { r: r + 1, c }];
          if (r - 1 >= 0 && !this.isCrateCell(r - 1, c) && !this.isHoleCell(r - 1, c)) return [{ r, c }, { r: r - 1, c }];
        }

        if (c + 1 < this.cols && !this.isCrateCell(r, c + 1) && !this.isHoleCell(r, c + 1) && this.wouldMatchAfterSwap({ r, c }, { r, c: c + 1 })) {
          return [{ r, c }, { r, c: c + 1 }];
        }
        if (r + 1 < this.rows && !this.isCrateCell(r + 1, c) && !this.isHoleCell(r + 1, c) && this.wouldMatchAfterSwap({ r, c }, { r: r + 1, c })) {
          return [{ r, c }, { r: r + 1, c }];
        }
      }
    }
    return null;
  }

  wouldMatchAfterSwap(posA, posB) {
    const tempA = this.grid[posA.r][posA.c];
    const tempB = this.grid[posB.r][posB.c];
    if (!tempA || !tempB || tempA.isCrate || tempB.isCrate || tempA.def.id === tempB.def.id) return false;
    this.grid[posA.r][posA.c] = tempB;
    this.grid[posB.r][posB.c] = tempA;
    const hasMatch = this.findAllMatches().cells.length > 0;
    this.grid[posA.r][posA.c] = tempA;
    this.grid[posB.r][posB.c] = tempB;
    return hasMatch;
  }

  async shuffleBoard() {
    this.showOverlay('SHUFFLE!', '有効な手がなくなったためカードをシャッフルします');
    await this.sleep(950);

    const movableCoords = [];
    const movableTiles = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] && !this.grid[r][c].isCrate) {
          movableCoords.push({ r, c });
          movableTiles.push(this.grid[r][c]);
        }
      }
    }

    let attempts = 0;
    do {
      for (let i = movableTiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [movableTiles[i], movableTiles[j]] = [movableTiles[j], movableTiles[i]];
      }
      movableCoords.forEach((pos, idx) => {
        this.grid[pos.r][pos.c] = movableTiles[idx];
      });
      attempts++;
    } while ((this.findAllMatches().cells.length > 0 || !this.findValidMove()) && attempts < 50);

    for (const pos of movableCoords) {
      this.updateTilePosition(this.grid[pos.r][pos.c], pos.r, pos.c, false);
    }

    this.hideOverlay();
    await this.sleep(300);
  }

  spawnSparkles(r, c) {
    const cellSpan = 100 / this.cols;
    const centerX = (c + 0.5) * cellSpan;
    const centerY = (r + 0.5) * cellSpan;

    for (let i = 0; i < 6; i++) {
      const p = document.createElement('div');
      p.className = 'sparkle-particle';
      p.style.left = `${centerX}%`;
      p.style.top = `${centerY}%`;
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
      const dist = 18 + Math.random() * 18;
      p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
      this.fxLayer.appendChild(p);
      setTimeout(() => p.remove(), 580);
    }
  }

  spawnFloatingScore(r, c, points, combo) {
    const cellSpan = 100 / this.cols;
    const el = document.createElement('div');
    el.className = 'floating-score';
    el.style.left = `${(c + 0.5) * cellSpan}%`;
    el.style.top = `${(r + 0.5) * cellSpan}%`;
    el.textContent = combo > 1 ? `+${points} (${combo} CHAIN!)` : `+${points}`;
    this.fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 880);
  }

  updateHUD(animateCombo = false) {
    this.hudScore.textContent = this.score.toLocaleString();
    this.hudModeLabel.textContent = 'MOVES';
    this.hudMoves.textContent = this.moves;
    this.hudCombo.textContent = `x${Math.max(1, this.combo)}`;

    if (animateCombo && this.combo > 1) {
      this.hudCombo.classList.remove('combo-active');
      void this.hudCombo.offsetWidth;
      this.hudCombo.classList.add('combo-active');
    } else {
      this.hudCombo.classList.remove('combo-active');
    }
  }

  showOverlay(title, sub) {
    this.overlayTitle.textContent = title;
    this.overlaySub.textContent = sub;
    this.overlay.classList.add('active');
  }

  hideOverlay() {
    this.overlay.classList.remove('active');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}