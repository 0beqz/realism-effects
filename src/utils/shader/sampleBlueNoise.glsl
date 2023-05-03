const float g = 1.6180339887498948482;
const float a1 = 1.0 / g;

// reference: https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
float r1(float n) {
    // 7th harmonious number
    return fract(1.1127756842787055 + a1 * n);
}

const vec4 hn = vec4(0.618033988749895, 0.3247179572447458, 0.2207440846057596, 0.1673039782614187);

vec4 sampleBlueNoise(sampler2D texture, int seed, vec2 repeat, vec2 texSize) {
    vec2 size = vUv * texSize;
    vec2 blueNoiseSize = texSize / repeat;
    float blueNoiseIndex = floor(floor(size.y / blueNoiseSize.y) * repeat.x) + floor(size.x / blueNoiseSize.x);

    // get the offset of this pixel's blue noise tile
    // int blueNoiseTileOffset = int(r1(blueNoiseIndex + 1.0) * 65536.);

    vec2 blueNoiseUv = vUv * repeat;

    // fetch blue noise for this pixel
    vec4 blueNoise = textureLod(texture, blueNoiseUv, 0.);

    // animate blue noise
    blueNoise = fract(blueNoise + hn * float(seed));

    blueNoise.r = (blueNoise.r > 0.5 ? 1.0 - blueNoise.r : blueNoise.r) * 2.0;
    blueNoise.g = (blueNoise.g > 0.5 ? 1.0 - blueNoise.g : blueNoise.g) * 2.0;
    blueNoise.b = (blueNoise.b > 0.5 ? 1.0 - blueNoise.b : blueNoise.b) * 2.0;
    blueNoise.a = (blueNoise.a > 0.5 ? 1.0 - blueNoise.a : blueNoise.a) * 2.0;

    return blueNoise;
}