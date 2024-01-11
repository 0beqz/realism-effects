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

float getBasicNeighborWeight(inout vec2 neighborUv, inout float wBasic, inout float wDisoccl) {
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

  wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi);
#else
  wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  wDisoccl = pow(wBasic, 0.1) * exp(-normalDiff * 5.);
}

vec3 getNormal(Material mat) {
#ifdef GBUFFER_TEXTURE
  return mat.normal;
#else
  vec3 depthVelocityTexel = textureLod(normalTexture, vUv, 0.).xyz;
  return unpackNormal(depthVelocityTexel.b);
#endif
}

void outputTexel(inout vec4 outputFrag, InputTexel inp) {
  inp.rgb /= inp.totalWeight;

  outputFrag.rgb = inp.rgb;
  toLinearSpace(outputFrag.rgb);
  outputFrag.a = inp.a;
}

void applyWeight(inout InputTexel inp, vec2 neighborUv, float wBasic, float wDisoccl) {
  float w = wBasic;
  vec4 t;
  if (inp.isSpecular) {
    t = textureLod(inputTexture2, neighborUv, 0.);
    w *= specularFactor;
    wDisoccl *= specularFactor;
  } else {
    t = textureLod(inputTexture, neighborUv, 0.);
  }

  float lumaDiff = abs(inp.luminance - luminance(t.rgb));
  float lumaFactor = exp(-lumaDiff * lumaPhi);
  w = mix(w * lumaFactor, wDisoccl * exp(-lumaDiff), pow(inp.w, 3.)) * inp.w;

  w *= step(0.01, w);

  toDenoiseSpace(t.rgb);

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

      // check: https://www.desmos.com/calculator/jurqfiigcf for graphs
      float age = 1. / log(exp(t.a * phi) + 1.718281828459045); // e - 1

      InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), age, 1., isTextureSpecular[i]);
      maxAlpha = max(maxAlpha, inp.a);

      toDenoiseSpace(inp.rgb);

      inputs[i] = inp;
    }
  }
#pragma unroll_loop_end

  mat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(mat);

  float flatness = 1. - min(length(fwidth(normal)), 1.);
  flatness *= flatness;
  flatness *= flatness;
  flatness = flatness * 0.9 + 0.1;

  glossiness = 1. - mat.roughness;
  glossiness *= glossiness;
  specularFactor = exp(-glossiness * specularPhi);

  float roughnessRadius = mix(mat.roughness * mat.roughness, 1., specularPhi);

  float r = flatness * radius * exp(-max(inputs[0].a, inputs[1].a) * 0.01);

  for (int i = 0; i < 8; i++) {
    {
      vec4 rand = blueNoise(vUv, blueNoiseIndex * 8 + i);
      vec2 u = r * (rand.xy * 2. - 1.) / resolution;
      float rRoughness = rand.b < mat.metalness ? roughnessRadius : 1.;

      vec2 neighborUv = vUv + rRoughness * u;

      float wBasic, wDisoccl;

      getBasicNeighborWeight(neighborUv, wBasic, wDisoccl);

      applyWeight(inputs[0], neighborUv, wBasic, wDisoccl);

#if textureCount == 2
      applyWeight(inputs[1], neighborUv, wBasic, wDisoccl);
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