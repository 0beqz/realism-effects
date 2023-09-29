uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseSize;
uniform int blueNoiseIndex;

// internal RNG state
uvec4 s1;
ivec2 pixel;

void rng_initialize(vec2 p, int index) {
  pixel = ivec2(p);

  // blue noise seed
  s1 = uvec4(index, index * 15843, index * 31 + 4566, index * 2345 + 58585);
}

// https://www.pcg-random.org/
void pcg4d(inout uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
  v = v ^ (v >> 16u);
  v.x += v.y * v.w;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v.w += v.y * v.z;
}

// random blue noise sampling pos
ivec2 shift2(ivec2 size) {
  pcg4d(s1);
  return (pixel + ivec2(s1.xy % 0x0fffffffu)) % size;
}

// needs a uniform called "resolution" with the size of the render target
vec4 blueNoise(vec2 uv, int index) {
  rng_initialize(vUv * resolution, index);

  vec4 blueNoise = texelFetch(blueNoiseTexture, shift2(ivec2(blueNoiseSize)), 0);

  return blueNoise;
}

vec4 blueNoise() { return blueNoise(vUv, int(blueNoiseIndex)); }
vec4 blueNoise(vec2 uv) { return blueNoise(uv, int(blueNoiseIndex)); }