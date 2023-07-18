const float g = 1.6180339887498948482;
const float a1 = 1.0 / g;

// reference:
// https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
float r1(float n) {
  // 7th harmonious number
  return fract(1.1127756842787055 + a1 * n);
}

const vec4 hn = vec4(0.618033988749895, 0.3247179572447458, 0.2207440846057596,
                     0.1673039782614187);

vec4 sampleBlueNoise(sampler2D tex, int seed, vec2 repeat, vec2 texSize,
                     vec2 uv) {
  vec2 blueNoiseUv = uv * repeat;

  // fetch blue noise for this pixel
  vec4 blueNoise = textureLod(tex, blueNoiseUv, 0.);

  // animate blue noise
  if (seed != 0) {
    blueNoise = fract(blueNoise + hn * float(seed));

    blueNoise.r = (blueNoise.r > 0.5 ? 1.0 - blueNoise.r : blueNoise.r) * 2.0;
    blueNoise.g = (blueNoise.g > 0.5 ? 1.0 - blueNoise.g : blueNoise.g) * 2.0;
    blueNoise.b = (blueNoise.b > 0.5 ? 1.0 - blueNoise.b : blueNoise.b) * 2.0;
    blueNoise.a = (blueNoise.a > 0.5 ? 1.0 - blueNoise.a : blueNoise.a) * 2.0;
  }

  return blueNoise;
}

vec4 sampleBlueNoise(sampler2D tex, int seed, vec2 repeat, vec2 texSize) {
  return sampleBlueNoise(tex, seed, repeat, texSize, vUv);
}
