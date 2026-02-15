const twiddleCache = new Map();

function isPowerOfTwo(value) {
  return value > 1 && (value & (value - 1)) === 0;
}

function buildTwiddles(size, inverse) {
  const half = size >> 1;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  const sign = inverse ? 1 : -1;

  for (let i = 0; i < half; i += 1) {
    const angle = (2 * Math.PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = sign * Math.sin(angle);
  }

  return { cos, sin };
}

function getTwiddles(size, inverse) {
  const key = `${size}:${inverse ? 'inv' : 'fwd'}`;
  let cache = twiddleCache.get(key);
  if (!cache) {
    cache = buildTwiddles(size, inverse);
    twiddleCache.set(key, cache);
  }
  return cache;
}

// Warm the common 2048 twiddle tables used by STFT.
getTwiddles(2048, false);
getTwiddles(2048, true);

/**
 * In-place radix-2 Cooley-Tukey FFT.
 * @param {Float32Array} re
 * @param {Float32Array} im
 * @param {boolean} inverse
 */
export function fft(re, im, inverse = false) {
  const size = re.length;
  if (size !== im.length) {
    throw new Error('FFT arrays must have matching lengths.');
  }
  if (!isPowerOfTwo(size)) {
    throw new Error('FFT length must be a power of two.');
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;

    if (i < j) {
      const reTmp = re[i];
      re[i] = re[j];
      re[j] = reTmp;

      const imTmp = im[i];
      im[i] = im[j];
      im[j] = imTmp;
    }
  }

  const { cos, sin } = getTwiddles(size, inverse);

  // Butterfly passes.
  for (let step = 2; step <= size; step <<= 1) {
    const halfStep = step >> 1;
    const stride = size / step;

    for (let block = 0; block < size; block += step) {
      for (let i = 0; i < halfStep; i += 1) {
        const tw = i * stride;
        const wr = cos[tw];
        const wi = sin[tw];

        const even = block + i;
        const odd = even + halfStep;

        const tr = wr * re[odd] - wi * im[odd];
        const ti = wr * im[odd] + wi * re[odd];

        re[odd] = re[even] - tr;
        im[odd] = im[even] - ti;
        re[even] += tr;
        im[even] += ti;
      }
    }
  }

  if (inverse) {
    const scale = 1 / size;
    for (let i = 0; i < size; i += 1) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }
}
