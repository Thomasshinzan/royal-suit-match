class RoyalMatchBoard {
  constructor(configData) {
    this.config = configData.boardConfig;
    this.tileDefs = configData.tiles;
    this.specialDefs = configData.specialCards;
    this.tileMap = new Map(this.tileDefs.map(t => [t.id, t]));
    this.tileMap.set(FLIP_STAR_DEF.id, FLIP_STAR_DEF);
    this.tileMap.set(FLIP_BLOCK_DEF.id, FLIP_BLOCK_DEF);
    this.specialMap = new Map(this.specialDefs.map(s => [s.id, s]));

    this.rows = this.config.rows;
    this.cols = this.config.cols;
    this.grid = [];

    this.boardEl = document.getElementById('game-board');
    this.tileLayer = document.getElementById('tile-layer');
    this.fxLayer = document.getElementById('fx-layer');
    this.hintLayer = document.getElementById('hint-layer');
    this.overlay = document.getElementById('message-overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayMessage = document.getElementById('overlay-message');
    this.overlayBtn = document.getElementById('overlay-btn');

    this.selectedCell = null;
    this.isBusy = false;
    this.dragStart = null;

    this.sound = new SoundEngine(this.config.sound || {});

    this.holeSet = new Set();
    this.partitionSet = new Set();
    this.partitionHSet = new Set();
  }

  setHoleMap(holeMap) {
    this.holeSet = new Set();
    if (!holeMap) return;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (holeMap[r]?.[c]) this.holeSet.add(`${r},${c}`);
      }
    }
  }

  isHoleCell(r, c) {
    return this.holeSet.has(`${r},${c}`);
  }

  isBlockerCell(r, c) {
    return this.isHoleCell(r, c) || this.isCrateCell(r, c) || this.isFlipBlockCell(r, c);
  }

  setPartitionMap(partitionMap) {
    this.partitionSet = new Set();
    if (!partitionMap) return;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (partitionMap[r]?.[c]) this.partitionSet.add(`${r},${c}`);
      }
    }
    this.renderPartitions();
  }

  // 水平方向の仕切り（床）：そのマスの下辺にある壁
  setPartitionHMap(partitionHMap) {
    this.partitionHSet = new Set();
    if (!partitionHMap) return;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (partitionHMap[r]?.[c]) this.partitionHSet.add(`${r},${c}`);
      }
    }
    this.renderPartitions();
  }

  hasPartitionRight(r, c) {
    return this.partitionSet.has(`${r},${c}`);
  }

  hasFloorBelow(r, c) {
    return this.partitionHSet.has(`${r},${c}`);
  }

  // a と b の間（隣接マス同士）に仕切りがあるか
  hasPartitionBetween(a, b) {
    if (a.r === b.r) {
      const left = Math.min(a.c, b.c);
      return this.hasPartitionRight(a.r, left);
    }
    if (a.c === b.c) {
      const top = Math.min(a.r, b.r);
      return this.hasFloorBelow(top, a.c);
    }
    return false;
  }

  renderPartitions() {
    if (!this.fxLayer) return;
    this.fxLayer.querySelectorAll('.partition-wall, .partition-wall-h').forEach(el => el.remove());
    if (!this.partitionSet && !this.partitionHSet) return;
    const cellPercent = 100 / this.cols;
    for (const key of this.partitionSet) {
      const [r, c] = key.split(',').map(Number);
      const el = document.createElement('div');
      el.className = 'partition-wall';
      el.style.left = `calc(${(c + 1) * cellPercent}% - 3px)`;
      el.style.top = `${r * cellPercent}%`;
      el.style.height = `${cellPercent}%`;
      this.fxLayer.appendChild(el);
    }
    for (const key of this.partitionHSet) {
      const [r, c] = key.split(',').map(Number);
      const el = document.createElement('div');
      el.className = 'partition-wall-h';
      el.style.top = `calc(${(r + 1) * cellPercent}% - 3px)`;
      el.style.left = `${c * cellPercent}%`;
      el.style.width = `${cellPercent}%`;
      this.fxLayer.appendChild(el);
    }
  }

  isCrateCell(r, c) {
    return Boolean(this.grid[r]?.[c]?.isCrate);
  }

  isTokenCell(r, c) {
    return Boolean(this.grid[r]?.[c]?.isToken);
  }

  isFrozenCell(r, c) {
    return Boolean(this.grid[r]?.[c]?.isFrozen);
  }

  isFlipBlockCell(r, c) {
    const tile = this.grid[r]?.[c];
    return Boolean(tile?.isFlip && tile.flipForm === 'block');
  }

  setTileFrozen(tile) {
    if (!tile || tile.isCrate || tile.isToken) return;
    tile.isFrozen = true;
    tile.el.classList.add('frozen-tile');
  }

  thawTile(tile) {
    if (!tile) return;
    tile.isFrozen = false;
    tile.el.classList.remove('frozen-tile', 'matched');
  }

  // 変化タイル：毎ターン ♠→♥→♦→♣ の順にスートが1つ進む。
  // バッジには「次になるスート」を表示する。スペシャル化すると変化は止まる。
  nextChangerSuitId(currentId) {
    const idx = CHANGER_CYCLE.indexOf(currentId);
    if (idx < 0) return CHANGER_CYCLE[0];
    return CHANGER_CYCLE[(idx + 1) % CHANGER_CYCLE.length];
  }

  setTileChanger(tile) {
    if (!tile || tile.isCrate || tile.isToken || tile.specialId) return;
    if (!CHANGER_CYCLE.includes(tile.def.id)) {
      // サイクル外のスート（ジョーカー等）はランダムなサイクルスートに寄せ、
      // 4回の変化で必ず元のスートに戻るようにする
      const startId = CHANGER_CYCLE[Math.floor(Math.random() * CHANGER_CYCLE.length)];
      tile.el.classList.remove(tile.def.cssClass);
      tile.def = this.tileMap.get(startId);
      tile.el.classList.add(tile.def.cssClass);
      const suitEl = tile.el.querySelector('.card-suit');
      if (suitEl) suitEl.textContent = tile.def.symbol;
    }
    tile.isChanger = true;
    tile.el.classList.add('changer-tile');
    this.refreshChangerBadge(tile);
  }

  clearTileChanger(tile) {
    if (!tile) return;
    tile.isChanger = false;
    tile.el.classList.remove('changer-tile');
    tile.el.querySelector('.changer-badge')?.remove();
  }

  refreshChangerBadge(tile) {
    if (!tile?.isChanger) return;
    let badge = tile.el.querySelector('.changer-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'changer-badge';
      tile.el.appendChild(badge);
    }
    const nextDef = this.tileMap.get(this.nextChangerSuitId(tile.def.id));
    badge.className = `changer-badge ${nextDef.cssClass}`;
    badge.textContent = nextDef.symbol;
  }

  // 手を1つ消費し終えた後に呼ぶ：盤面の変化タイルをすべて次のスートへ進める
  advanceChangerTiles() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.grid[r][c];
        if (!tile?.isChanger || tile.specialId) continue;
        tile.el.classList.remove(tile.def.cssClass);
        tile.def = this.tileMap.get(this.nextChangerSuitId(tile.def.id));
        tile.el.classList.add(tile.def.cssClass);
        const suitEl = tile.el.querySelector('.card-suit');
        if (suitEl) suitEl.textContent = tile.def.symbol;
        this.refreshChangerBadge(tile);
      }
    }
  }

  // 変転タイル：1手ごとに ☆（ワイルド）⇄ お邪魔（ブロック）を切り替える。
  // ☆はどのスートとも揃うワイルド。お邪魔は入れ替え・消去・落下が一切
  // できない。スペシャル化すると変転は終わる。
  setTileFlip(tile) {
    if (!tile || tile.isCrate || tile.isToken || tile.specialId) return;
    tile.isFlip = true;
    tile.flipForm = 'star';
    this.refreshFlipVisual(tile);
  }

  clearTileFlip(tile) {
    if (!tile) return;
    tile.isFlip = false;
    tile.el.classList.remove('flip-tile', 'flip-block-form');
  }

  refreshFlipVisual(tile) {
    if (!tile?.isFlip) return;
    const isBlock = tile.flipForm === 'block';
    tile.el.classList.remove(FLIP_STAR_DEF.cssClass, FLIP_BLOCK_DEF.cssClass);
    tile.def = isBlock ? FLIP_BLOCK_DEF : FLIP_STAR_DEF;
    tile.el.classList.add(tile.def.cssClass, 'flip-tile');
    tile.el.classList.toggle('flip-block-form', isBlock);
    const suitEl = tile.el.querySelector('.card-suit');
    if (suitEl) suitEl.textContent = tile.def.symbol;
  }

  // 手を1つ消費し終えた後に呼ぶ：盤面の変転タイルをすべて反転させる
  flipTiles() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.grid[r][c];
        if (!tile?.isFlip || tile.specialId) continue;
        tile.flipForm = tile.flipForm === 'star' ? 'block' : 'star';
        this.refreshFlipVisual(tile);
      }
    }
  }

  // 初期盤面に出来てしまったマッチを、通常タイルの引き直しで解消する
  // （ワイルド化した変転タイルの周囲で発生しうる）
  breakInitialMatches() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const { cells } = this.findAllMatches();
      if (cells.length === 0) return;
      let changed = false;
      for (const { r, c } of cells) {
        const tile = this.grid[r][c];
        if (!tile || tile.isCrate || tile.isToken || tile.specialId || tile.isFlip || tile.isFrozen) continue;
        const oldDef = tile.def;
        const def = this.pickSafeDefAt(r, c);
        if (def) {
          tile.el.classList.remove(oldDef.cssClass);
          tile.el.classList.add(def.cssClass);
          const suitEl = tile.el.querySelector('.card-suit');
          if (suitEl) suitEl.textContent = def.symbol;
          changed = true;
        }
      }
      if (!changed) return;
    }
  }

  // (r,c) に置くと、そのマスを含むマッチが成立しないスートを返す
  pickSafeDefAt(r, c) {
    const tile = this.grid[r][c];
    if (!tile) return null;
    const original = tile.def;
    const candidates = [...this.tileDefs].sort(() => Math.random() - 0.5);
    for (const def of candidates) {
      if (def.id === original.id) continue;
      tile.def = def;
      const matched = this.findAllMatches().cells.some(cell => cell.r === r && cell.c === c);
      if (!matched) return def;
    }
    tile.def = original;
    return null;
  }

  // 破壊不可能トークン（👑クラウン）。マッチやスペシャルでは消えないが、
  // 重力で落下し、最下段に到達すると回収される。
  createTokenObject(r, c, visualRow = r) {
    const def = { id: 'token', name: 'クラウン', scoreWeight: 0 };
    const el = document.createElement('div');
    el.className = 'card-tile token-tile';
    el.innerHTML = `<span class="token-icon">👑</span>`;
    this.applyTileCoordinates(el, visualRow, c);
    this.tileLayer.appendChild(el);
    return {
      def,
      el,
      isToken: true,
      isCrate: false,
      specialId: null,
      row: r,
      col: c
    };
  }

  isTokenObject(tile) {
    return Boolean(tile?.isToken);
  }

  createCrateObject(crateDef, r, c, visualRow = r) {
    const el = document.createElement('div');
    const hp = crateDef.hp || 1;
    el.className = `card-tile crate-tile ${hp > 1 ? 'crate-iron' : 'crate-wood'}`;
    el.innerHTML = `<span class="crate-icon">${hp > 1 ? '⬛' : '🟫'}</span>`;
    this.applyTileCoordinates(el, visualRow, c);
    this.tileLayer.appendChild(el);
    return {
      def: crateDef,
      el,
      hp,
      maxHp: hp,
      isCrate: true,
      specialId: null,
      row: r,
      col: c
    };
  }

  refreshCrateVisual(tile) {
    if (!tile?.isCrate) return;
    if (tile.hp <= 1) {
      tile.el.classList.remove('crate-iron');
      tile.el.classList.add('crate-wood');
      const iconEl = tile.el.querySelector('.crate-icon');
      if (iconEl) iconEl.textContent = '🟫';
    }
  }

  damageCratesAtCells(cells) {
    let destroyed = 0;
    for (const { r, c } of cells) {
      const tile = this.grid[r]?.[c];
      if (!tile || !tile.isCrate) continue;
      tile.hp -= 1;
      this.sound.playCrateHit();
      if (tile.hp <= 0) {
        tile.el.remove();
        this.grid[r][c] = null;
        destroyed++;
        this.spawnSparkles(r, c);
      } else {
        this.refreshCrateVisual(tile);
      }
    }
    return destroyed;
  }

  createTileObject(def, r, c, visualRow = r, specialId = null) {
    const el = document.createElement('div');
    el.className = `card-tile ${def.cssClass}`;
    el.innerHTML = `<span class="card-suit">${def.symbol}</span>`;
    this.applyTileCoordinates(el, visualRow, c);
    this.tileLayer.appendChild(el);

    const tile = {
      def,
      el,
      specialId: null,
      row: r,
      col: c
    };

    if (specialId) {
      this.upgradeTileToSpecial(tile, specialId);
    }

    return tile;
  }

  upgradeTileToSpecial(tile, specialId) {
    const specialDef = this.specialMap.get(specialId);
    if (!specialDef) return;
    if (tile.isChanger) this.clearTileChanger(tile);
    if (tile.isFlip) this.clearTileFlip(tile);
    tile.specialId = specialId;
    tile.el.classList.remove('matched', 'selected', 'hint', 'rank-J', 'rank-Q', 'rank-K', 'rank-A');
    tile.el.classList.add('special-card', `rank-${specialDef.rank}`);
    tile.el.innerHTML = `<span class="special-icon-main">${specialDef.icon}</span>`;
  }

  findAllMatches() {
    const horizSet = new Set();
    const vertSet = new Set();
    const allSet = new Set();
    const wildAttrib = new Map();

    const SUITS = ['spade', 'heart', 'diamond', 'club', 'joker'];
    const isWildAt = (r, c) => this.grid[r]?.[c]?.def.id === 'wild';
    // マッチの対象にならないマス（ランがここで途切れる）
    const isLineBlocker = (r, c) => {
      const tile = this.grid[r]?.[c];
      return !tile || tile.isCrate || tile.isToken || this.isHoleCell(r, c) || (tile.isFlip && tile.flipForm === 'block');
    };

    // 区間内をスート別に走査する。ワイルド（☆）はどのスートのランにも
    // 加わるが、実タイルが1枚もないランはマッチにしない。
    const scanSegment = (seg, isHoriz) => {
      for (const suit of SUITS) {
        let run = [];
        const flushRun = () => {
          if (run.length >= this.config.minMatchLength && run.some(({ r, c }) => this.grid[r][c].def.id === suit)) {
            for (const { r, c } of run) {
              const key = `${r},${c}`;
              (isHoriz ? horizSet : vertSet).add(key);
              allSet.add(key);
              if (isWildAt(r, c)) {
                const prev = wildAttrib.get(key);
                if (!prev || run.length > prev.len || (run.length === prev.len && isHoriz && !prev.horiz)) {
                  wildAttrib.set(key, { suitId: suit, len: run.length, horiz: isHoriz });
                }
              }
            }
          }
          run = [];
        };
        for (const cell of seg) {
          const id = this.grid[cell.r][cell.c].def.id;
          if (id === suit || id === 'wild') {
            // ワイルド同士はランの中で隣り合えない（☆の塊が自動的に
            // マッチしてしまうのを防ぐバランス規則）
            if (id === 'wild' && run.length > 0) {
              const prev = run[run.length - 1];
              if (this.grid[prev.r][prev.c].def.id === 'wild') flushRun();
            }
            run.push(cell);
          } else flushRun();
        }
        flushRun();
      }
    };

    const scanLine = (cells, isHoriz) => {
      let seg = [];
      for (const cell of cells) {
        if (isLineBlocker(cell.r, cell.c)) {
          if (seg.length > 0) scanSegment(seg, isHoriz);
          seg = [];
        } else {
          seg.push(cell);
        }
      }
      if (seg.length > 0) scanSegment(seg, isHoriz);
    };

    for (let r = 0; r < this.rows; r++) {
      scanLine(Array.from({ length: this.cols }, (_, c) => ({ r, c })), true);
    }
    for (let c = 0; c < this.cols; c++) {
      scanLine(Array.from({ length: this.rows }, (_, r) => ({ r, c })), false);
    }

    // 各マッチセルの帰属スート（ワイルドは属したランのスートとして数える）
    const suitOf = (r, c) => {
      const tile = this.grid[r][c];
      if (!tile) return null;
      if (tile.def.id === 'wild') return wildAttrib.get(`${r},${c}`)?.suitId || null;
      return tile.def.id;
    };
    const cellSuits = new Map();
    for (const key of allSet) {
      const [r, c] = key.split(',').map(Number);
      const s = suitOf(r, c);
      if (s) cellSuits.set(key, s);
    }

    const visited = new Set();
    const groups = [];
    for (const key of allSet) {
      if (visited.has(key)) continue;
      const [sr, sc] = key.split(',').map(Number);
      const suitId = suitOf(sr, sc);
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
          if (allSet.has(nKey) && !visited.has(nKey) && (suitOf(nr, nc) === suitId || isWildAt(nr, nc) || isWildAt(curr.r, curr.c))) {
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

    return { cells, groups, cellSuits };
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
        while (segmentTop - 1 >= 0 && !this.isBlockerCell(segmentTop - 1, c) && !this.hasFloorBelow(segmentTop - 1, c)) {
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
        if (!curr || curr.isCrate || curr.isFrozen || (curr.isFlip && curr.flipForm === 'block')) continue;

        if (curr.isToken) {
          // クラウン自体はマッチしないが、相手タイルがマッチするなら有効な手
          if (c + 1 < this.cols && !this.hasPartitionBetween({ r, c }, { r, c: c + 1 }) && this.wouldMatchAfterSwap({ r, c }, { r, c: c + 1 })) return [{ r, c }, { r, c: c + 1 }];
          if (r + 1 < this.rows && !this.hasPartitionBetween({ r, c }, { r, c: c + 1 }) && this.wouldMatchAfterSwap({ r, c }, { r: r + 1, c })) return [{ r, c }, { r: r + 1, c }];
          continue;
        }

        if (curr.specialId) {
          if (c + 1 < this.cols && !this.isCrateCell(r, c + 1) && !this.isHoleCell(r, c + 1) && !this.isFrozenCell(r, c + 1) && !this.isFlipBlockCell(r, c + 1) && !this.hasPartitionBetween({ r, c }, { r, c: c + 1 })) return [{ r, c }, { r, c: c + 1 }];
          if (c - 1 >= 0 && !this.isCrateCell(r, c - 1) && !this.isHoleCell(r, c - 1) && !this.isFrozenCell(r, c - 1) && !this.isFlipBlockCell(r, c - 1) && !this.hasPartitionBetween({ r, c }, { r, c: c - 1 })) return [{ r, c }, { r, c: c - 1 }];
          if (r + 1 < this.rows && !this.isCrateCell(r + 1, c) && !this.isHoleCell(r + 1, c) && !this.isFrozenCell(r + 1, c) && !this.isFlipBlockCell(r + 1, c) && !this.hasPartitionBetween({ r, c }, { r: r + 1, c })) return [{ r, c }, { r: r + 1, c }];
          if (r - 1 >= 0 && !this.isCrateCell(r - 1, c) && !this.isHoleCell(r - 1, c) && !this.isFrozenCell(r - 1, c) && !this.isFlipBlockCell(r - 1, c) && !this.hasPartitionBetween({ r, c }, { r: r - 1, c })) return [{ r, c }, { r: r - 1, c }];
        }

        if (c + 1 < this.cols && !this.isCrateCell(r, c + 1) && !this.isHoleCell(r, c + 1) && !this.hasPartitionBetween({ r, c }, { r, c: c + 1 }) && this.wouldMatchAfterSwap({ r, c }, { r, c: c + 1 })) {
          return [{ r, c }, { r, c: c + 1 }];
        }
        if (r + 1 < this.rows && !this.isCrateCell(r + 1, c) && !this.isHoleCell(r + 1, c) && !this.hasPartitionBetween({ r, c }, { r: r + 1, c }) && this.wouldMatchAfterSwap({ r, c }, { r: r + 1, c })) {
          return [{ r, c }, { r: r + 1, c }];
        }
      }
    }
    return null;
  }

  wouldMatchAfterSwap(posA, posB) {
    const tempA = this.grid[posA.r][posA.c];
    const tempB = this.grid[posB.r][posB.c];
    if (!tempA || !tempB || tempA.isCrate || tempB.isCrate || tempA.isFrozen || tempB.isFrozen || this.isFlipBlockCell(posA.r, posA.c) || this.isFlipBlockCell(posB.r, posB.c) || tempA.def.id === tempB.def.id) return false;
    this.grid[posA.r][posA.c] = tempB;
    this.grid[posB.r][posB.c] = tempA;
    const hasMatch = this.findAllMatches().cells.length > 0;
    this.grid[posA.r][posA.c] = tempA;
    this.grid[posB.r][posB.c] = tempB;
    return hasMatch;
  }

  // 詰み盤面の自動判定：有効な手がなければ自動でシャッフルする
  async ensurePlayableBoard() {
    if (this.findValidMove()) return false;
    await this.shuffleBoard();
    return true;
  }

  async shuffleBoard() {
    this.showOverlay('SHUFFLE!', '有効な手がなくなったためカードをシャッフルします');
    await this.sleep(950);

    // 木箱とクラウンは動かさない（クラウンの落下進捗を保つため）
    const movableCoords = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] && !this.grid[r][c].isCrate && !this.grid[r][c].isToken && !this.grid[r][c].isFrozen && !this.isFlipBlockCell(r, c)) {
          movableCoords.push({ r, c });
        }
      }
    }
    let movableTiles = movableCoords.map(pos => this.grid[pos.r][pos.c]);

    const isPlayable = () => this.findAllMatches().cells.length === 0 && Boolean(this.findValidMove());
    const shuffleOnce = () => {
      for (let i = movableTiles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [movableTiles[i], movableTiles[j]] = [movableTiles[j], movableTiles[i]];
      }
      movableCoords.forEach((pos, idx) => {
        this.grid[pos.r][pos.c] = movableTiles[idx];
      });
    };

    // まず並べ替えで解を探し、見つからなければタイル自体を
    // 引き直して（スペシャルは保持）必ず手がある盤面にする
    let rerolls = 0;
    while (!isPlayable() && rerolls <= 10) {
      for (let i = 0; i < 50 && !isPlayable(); i++) shuffleOnce();
      if (isPlayable()) break;

      rerolls++;
      movableTiles = movableCoords.map(pos => {
        const old = this.grid[pos.r][pos.c];
        const specialId = old?.specialId || null;
        const wasChanger = Boolean(old?.isChanger);
        const wasFlip = Boolean(old?.isFlip);
        if (old) old.el.remove();
        const fresh = this.createTileObject(this.getRandomTileDef(), pos.r, pos.c, pos.r, specialId);
        if (wasChanger && !specialId) this.setTileChanger(fresh);
        if (wasFlip && !specialId) this.setTileFlip(fresh);
        this.grid[pos.r][pos.c] = fresh;
        return fresh;
      });
    }

    for (const pos of movableCoords) {
      this.updateTilePosition(this.grid[pos.r][pos.c], pos.r, pos.c, false);
    }

    this.hideOverlay();
    if (typeof this.saveGame === 'function') this.saveGame();
    await this.sleep(300);
  }

  spawnSparkles(r, c) {
    const cellSpan = 100 / this.cols;
    const centerX = (c + 0.5) * cellSpan;
    const centerY = (r + 0.5) * cellSpan;

    for (let i = 0; i < 6; i++) {
      const sp = document.createElement('div');
      sp.className = 'sparkle';
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const dist = 4 + Math.random() * 6;
      sp.style.left = `${centerX + Math.cos(angle) * dist}%`;
      sp.style.top = `${centerY + Math.sin(angle) * dist}%`;
      sp.style.backgroundColor = ['#fff176', '#ffd54f', '#ffb74d'][i % 3];
      this.fxLayer.appendChild(sp);
      setTimeout(() => sp.remove(), 550);
    }
  }

  showOverlay(title, message, buttonText = null) {
    this.overlayTitle.textContent = title;
    this.overlayMessage.innerHTML = message;
    if (buttonText !== null) {
      this.overlayBtn.textContent = buttonText;
    }
    this.overlay.classList.add('active');
  }

  hideOverlay() {
    this.overlay.classList.remove('active');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  applyTileCoordinates(el, r, c) {
    const cellPercent = 100 / this.cols;
    el.style.width = `calc(${cellPercent}% - 6px)`;
    el.style.height = `calc(${cellPercent}% - 6px)`;
    el.style.transform = `translate(${c * 100}%, ${r * 100}%) translate(3px, 3px)`;
  }

  updateTilePosition(tile, newRow, newCol, isFalling = false) {
    if (!tile) return;
    tile.row = newRow;
    tile.col = newCol;
    tile.el.classList.toggle('falling', isFalling);
    this.applyTileCoordinates(tile.el, newRow, newCol);
  }

  // 最下段に到達したクラウンを回収し、詰まった列を補充する
  async collectDroppedTokensAndRefill() {
    let collected = 0;
    const bottomRow = this.rows - 1;
    for (let c = 0; c < this.cols; c++) {
      const tile = this.grid[bottomRow][c];
      if (tile?.isToken && !this.hasFloorBelow(bottomRow, c)) {
        tile.el.remove();
        this.grid[bottomRow][c] = null;
        collected++;
        this.spawnSparkles(bottomRow, c);
      }
    }
    if (collected > 0) {
      if (typeof this.recordTokenProgress === 'function') this.recordTokenProgress(collected);
      await this.applyGravityAndRefill();
    }
    return collected;
  }
}

// 変化タイルのスート変化サイクル（♠→♥→♦→♣→♠…）
const CHANGER_CYCLE = ['spade', 'heart', 'diamond', 'club'];

// 変転タイルの2形態：☆（ワイルド）とお邪魔（ブロック）。tileDefs には
// 含めず tileMap にだけ登録するので、通常スポーンで出現することはない。
const FLIP_STAR_DEF = { id: 'wild', name: 'ワイルド', symbol: '☆', cssClass: 'suit-wild', scoreWeight: 1, spawnWeight: 0, type: 'special' };
const FLIP_BLOCK_DEF = { id: 'flipblock', name: 'お邪魔', symbol: '✖', cssClass: 'suit-flipblock', scoreWeight: 0, spawnWeight: 0, type: 'special' };
