varying vec2 vUv;

uniform sampler2D inputTexture;
uniform highp sampler2D depthTexture;
uniform sampler2D normalTexture; // optional, in case no gBufferTexture is used
uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float radius;
uniform float phi;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float specularPhi;
uniform vec2 resolution;

layout(location = 0) out vec4 gOutput0;

#if textureCount == 2
uniform sampler2D inputTexture2;
layout(location = 1) out vec4 gOutput1;
#endif

#include <common>
#include <gbuffer_packing>

#define luminance(a) pow(dot(vec3(0.2125, 0.7154, 0.0721), a), 0.125)

#if textureCount == 1
#define inputTexture2 inputTexture
#endif

Material mat;
vec3 normal;
float depth;
float glossiness;
float specularFactor;

struct InputTexel {
  vec3 rgb;
  float a;
  float luminance;
  float w;
  float totalWeight;
  bool isSpecular;
};

void toDenoiseSpace(inout vec3 color) { color = log(color + 1.); }
void toLinearSpace(inout vec3 color) { color = exp(color) - 1.; }

float getBasicNeighborWeight(inout vec2 neighborUv) {
#ifdef GBUFFER_TEXTURE
  Material neighborMat = getMaterial(gBufferTexture, neighborUv);
  vec3 neighborNormal = neighborMat.normal;
  float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).r;
#else
  vec3 neighborDepthVelocityTexel = textureLod(normalTexture, neighborUv, 0.).xyz;
  vec3 neighborNormal = unpackNormal(neighborDepthVelocityTexel.b);
  float neighborDepth = neighborDepthVelocityTexel.a;
#endif

  if (neighborDepth == 1.0)
    return 0.;

  float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
  float depthDiff = 10000. * abs(depth - neighborDepth);

#ifdef GBUFFER_TEXTURE
  float roughnessDiff = abs(mat.roughness - neighborMat.roughness);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi);
#else
  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  return wBasic;
}

vec3 getNormal(Material mat) {
#ifdef GBUFFER_TEXTURE
  return mat.normal;
#else
  vec3 depthVelocityTexel = textureLod(normalTexture, vUv, 0.).xyz;
  return unpackNormal(depthVelocityTexel.b);
#endif
}

#define SQRT_2 1.41421356237

vec2 POISSON[8] = vec2[](vec2(-1.0, 0.0), vec2(0.0, -1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(-0.25 * SQRT_2, -0.25 * SQRT_2),
                         vec2(0.25 * SQRT_2, -0.25 * SQRT_2), vec2(0.25 * SQRT_2, 0.25 * SQRT_2), vec2(-0.25 * SQRT_2, 0.25 * SQRT_2));

void outputTexel(inout vec4 outputFrag, InputTexel inp) {
  inp.rgb /= inp.totalWeight;

  outputFrag.rgb = inp.rgb;
  toLinearSpace(outputFrag.rgb);
  outputFrag.a = inp.a;
}

void applyWeight(inout InputTexel inp, vec2 neighborUv, float wBasic) {
  float w = wBasic;

  vec4 t;
  if (inp.isSpecular) {
    t = textureLod(inputTexture2, neighborUv, 0.);
    w *= specularFactor;
  } else {
    t = textureLod(inputTexture, neighborUv, 0.);
  }
  toDenoiseSpace(t.rgb);

  float disocclW = pow(w, 0.1);
  float lumaDiff = abs(inp.luminance - luminance(t.rgb));
  lumaDiff = min(lumaDiff, 0.5);
  float lumaFactor = exp(-lumaDiff * lumaPhi);
  w = mix(w * lumaFactor, disocclW, inp.w) * inp.w;

  w *= step(0.0001, w);

  inp.rgb += w * t.rgb;
  inp.totalWeight += w;
}

void main() {
  depth = textureLod(depthTexture, vUv, 0.).r;

  if (depth == 1.0 && fwidth(depth) == 0.) {
    discard;
    return;
  }

  InputTexel[textureCount] inputs;

  float maxAlpha = 0.;
#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    {
      vec4 t;

      if (isTextureSpecular[i]) {
        t = textureLod(inputTexture2, vUv, 0.);
      } else {
        t = textureLod(inputTexture, vUv, 0.);
      }

      // check: https://www.desmos.com/calculator/isdut5hmdm for graphs
      float age = 1. / pow(t.a + 1., 1.2 * phi);
      // age = exp(-pow(log(t.a + 1.), phi));
      // float l = log2(t.a + 2.);
      // l *= l;
      // age = exp(-phi * l);

      // the color becomes darker over time possibly due to precision issues, so we brighten it a bit
      t.rgb *= 1.0003;

      toDenoiseSpace(t.rgb);
      InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), age, 1., isTextureSpecular[i]);
      maxAlpha = max(maxAlpha, inp.a);

      inputs[i] = inp;
    }
  }
#pragma unroll_loop_end

  mat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(mat);
  glossiness = max(0., 4. * (1. - mat.roughness / 0.25));
  specularFactor = exp(-glossiness * specularPhi);

  float flatness = 1. - min(length(fwidth(normal)), 1.);
  flatness = pow(flatness, 2.) * 0.75 + 0.25;

  // float roughnessRadius = mix(sqrt(mat.roughness), 1., 0.5 * (1. - mat.metalness));

  vec4 random = blueNoise();
  float r = radius;

  // rotate the poisson disk
  float angle = random.r * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rm = r * flatness * mat2(c, -s, s, c);

  for (int i = 0; i < 8; i++) {
    {
      vec2 offset = POISSON[i];

      vec2 neighborUv = vUv + rm * (offset / resolution);

      float wBasic = getBasicNeighborWeight(neighborUv);

      applyWeight(inputs[0], neighborUv, wBasic);

#if textureCount == 2
      applyWeight(inputs[1], neighborUv, wBasic);
#endif
    }
  }

  // inputs[0].rgb = vec3(1.);
  // inputs[0].totalWeight = 1.;

  outputTexel(gOutput0, inputs[0]);

#if textureCount == 2
  outputTexel(gOutput1, inputs[1]);
#endif
}