(function (root) {
  'use strict';

  const VERSION = 4;
  const SIZE = 21 + (VERSION - 1) * 4;
  const DATA_CODEWORDS = 80;
  const ECC_CODEWORDS = 20;
  const ALIGNMENT_POSITIONS = [6, 26];

  const EXP = new Array(512);
  const LOG = new Array(256);
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i += 1) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, degree) {
    const generator = rsGenerator(degree);
    const result = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ result.shift();
      result.push(0);
      for (let i = 0; i < degree; i += 1) {
        result[i] ^= gfMul(generator[i + 1], factor);
      }
    }
    return result;
  }

  function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  }

  function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  function makeCodewords(text) {
    const bytes = utf8Bytes(text);
    if (bytes.length > 78) {
      throw new Error('QR link is too long for the built-in generator');
    }

    const bits = [];
    appendBits(bits, 0x4, 4); // byte mode
    appendBits(bits, bytes.length, 8);
    for (const byte of bytes) appendBits(bits, byte, 8);
    appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
    while (bits.length % 8) bits.push(0);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }
    for (let pad = 0xec; data.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) {
      data.push(pad);
    }
    return [...data, ...rsRemainder(data, ECC_CODEWORDS)];
  }

  function makeGrid() {
    return {
      modules: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false)),
      reserved: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false))
    };
  }

  function setFunction(grid, x, y, dark) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    grid.modules[y][x] = !!dark;
    grid.reserved[y][x] = true;
  }

  function drawFinder(grid, x, y) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        const inPattern = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inPattern
          && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFunction(grid, xx, yy, dark);
      }
    }
  }

  function drawAlignment(grid, cx, cy) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(grid, cx + dx, cy + dy, dist === 2 || dist === 0);
      }
    }
  }

  function reserveFormat(grid) {
    for (let i = 0; i <= 5; i += 1) setFunction(grid, 8, i, false);
    setFunction(grid, 8, 7, false);
    setFunction(grid, 8, 8, false);
    setFunction(grid, 7, 8, false);
    for (let i = 9; i < 15; i += 1) setFunction(grid, 14 - i, 8, false);
    for (let i = 0; i < 8; i += 1) setFunction(grid, SIZE - 1 - i, 8, false);
    for (let i = 8; i < 15; i += 1) setFunction(grid, 8, SIZE - 15 + i, false);
  }

  function drawFunctionPatterns(grid) {
    drawFinder(grid, 0, 0);
    drawFinder(grid, SIZE - 7, 0);
    drawFinder(grid, 0, SIZE - 7);

    for (let i = 8; i < SIZE - 8; i += 1) {
      setFunction(grid, i, 6, i % 2 === 0);
      setFunction(grid, 6, i, i % 2 === 0);
    }

    for (const x of ALIGNMENT_POSITIONS) {
      for (const y of ALIGNMENT_POSITIONS) {
        if ((x === 6 && y === 6) || (x === 6 && y === SIZE - 7) || (x === SIZE - 7 && y === 6)) continue;
        drawAlignment(grid, x, y);
      }
    }

    setFunction(grid, 8, VERSION * 4 + 9, true);
    reserveFormat(grid);
  }

  function formatBits(mask) {
    const ecLevelLow = 1;
    const data = (ecLevelLow << 3) | mask;
    let bits = data << 10;
    for (let i = 14; i >= 10; i -= 1) {
      if (((bits >>> i) & 1) !== 0) bits ^= 0x537 << (i - 10);
    }
    return ((data << 10) | bits) ^ 0x5412;
  }

  function writeFormat(grid, mask) {
    const bits = formatBits(mask);
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) setFunction(grid, 8, i, bit(i));
    setFunction(grid, 8, 7, bit(6));
    setFunction(grid, 8, 8, bit(7));
    setFunction(grid, 7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) setFunction(grid, 14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) setFunction(grid, SIZE - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) setFunction(grid, 8, SIZE - 15 + i, bit(i));
  }

  function placeData(grid, codewords) {
    const bits = [];
    for (const byte of codewords) appendBits(bits, byte, 8);

    let bitIndex = 0;
    let upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let vert = 0; vert < SIZE; vert += 1) {
        const y = upward ? SIZE - 1 - vert : vert;
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          if (grid.reserved[y][x]) continue;
          let dark = bitIndex < bits.length && bits[bitIndex] === 1;
          bitIndex += 1;
          if ((x + y) % 2 === 0) dark = !dark; // mask 0
          grid.modules[y][x] = dark;
        }
      }
      upward = !upward;
    }
  }

  function createMatrix(text) {
    const grid = makeGrid();
    drawFunctionPatterns(grid);
    placeData(grid, makeCodewords(text));
    writeFormat(grid, 0);
    return grid.modules.map(row => row.map(Boolean));
  }

  function draw(ctx, text, x, y, size, options = {}) {
    const matrix = createMatrix(text);
    const quiet = options.quiet == null ? 4 : options.quiet;
    const modules = matrix.length + quiet * 2;
    const cell = size / modules;
    ctx.save();
    ctx.fillStyle = options.background || '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = options.foreground || '#1c1c1e';
    for (let row = 0; row < matrix.length; row += 1) {
      for (let col = 0; col < matrix.length; col += 1) {
        if (!matrix[row][col]) continue;
        ctx.fillRect(
          x + (col + quiet) * cell,
          y + (row + quiet) * cell,
          Math.ceil(cell),
          Math.ceil(cell)
        );
      }
    }
    ctx.restore();
    return matrix;
  }

  const api = { createMatrix, draw, size: SIZE, version: VERSION };
  root.CiteBeatQR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
