varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
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

Material mat;
vec3 normal;
float depth;
float glossiness;

struct InputTexel {
  vec3 rgb;
  float a;
  float luminance;
  float w;
  float totalWeight;
  bool isSpecular;
};

struct Neighbor {
  vec4 texel;
  float weight;
};

void evaluateNeighbor(inout InputTexel inp, inout Neighbor neighbor) {
  // abort here as otherwise we'd lose too much precision
  if (neighbor.weight < 0.01)
    return;

  inp.rgb += neighbor.weight * neighbor.texel.rgb;
  inp.totalWeight += neighbor.weight;
}

void getNeighborWeight(inout InputTexel[textureCount] inputs, inout Neighbor[textureCount] neighbors, inout vec2 neighborUv) {
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
    return;

  float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
  float depthDiff = 10000. * abs(depth - neighborDepth);

#ifdef GBUFFER_TEXTURE
  float roughnessDiff = abs(mat.roughness - neighborMat.roughness);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi);
#else
  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  float sw = exp(-normalDiff * 5.);

  for (int i = 0; i < textureCount; i++) {
    vec4 t;
    float specularFactor = 1.;

    if (isTextureSpecular[i]) {
      t = textureLod(inputTexture2, neighborUv, 0.);
      specularFactor = exp(-glossiness * specularPhi);
    } else {
      t = textureLod(inputTexture, neighborUv, 0.);
    }

    float lumaDiff = abs(inputs[i].luminance - luminance(t.rgb));
    float lumaFactor = exp(-lumaDiff * lumaPhi);

    float w = specularFactor * mix(wBasic * lumaFactor, sw, inputs[i].w);

    // calculate the final weight of the neighbor
    w *= inputs[i].w;

    neighbors[i] = Neighbor(t, w);
  }
}

vec3 getNormal(Material mat) {
#ifdef GBUFFER_TEXTURE
  return mat.normal;
#else
  vec3 depthVelocityTexel = textureLod(normalTexture, vUv, 0.).xyz;
  return unpackNormal(depthVelocityTexel.b);
#endif
}

const vec2 poissonDisk[8] = POISSON_DISK_SAMPLES;

void outputTexel(inout vec4 outputFrag, InputTexel inp) {
  inp.rgb /= inp.totalWeight;

  outputFrag.rgb = inp.rgb;
  outputFrag.a = inp.a;
}

void main() {
  depth = textureLod(depthTexture, vUv, 0.).r;

  if (depth == 1.0) {
    discard;
    return;
  }

  InputTexel[textureCount] inputs;

  float maxAlpha = 0.;
  for (int i = 0; i < textureCount; i++) {
    vec4 t;
    if (i == 0) {
      t = textureLod(inputTexture, vUv, 0.);
    } else {
      t = textureLod(inputTexture2, vUv, 0.);
    }

    // check: https://www.desmos.com/calculator/gp9bylydht for graphs
    // float age = 1. / log(pow(t.a, 0.2 * (t.a + 4.)) + 3. + t.a);
    float age = 1. / (log(pow(t.a, phi * (t.a + 10.)) + 1. + t.a) + 1.);
    // float age = 1. / (t.a + 1.);

    InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), age, 1., isTextureSpecular[i]);
    maxAlpha = max(maxAlpha, inp.a);

    inputs[i] = inp;
  }

  if (maxAlpha > 512.) {
    gOutput0 = vec4(inputs[0].rgb, inputs[0].a);

#if textureCount == 2
    gOutput1 = vec4(inputs[1].rgb, inputs[1].a);
#endif
    return;
  }

  mat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(mat);
  glossiness = max(0., 4. * (1. - mat.roughness / 0.25));

  float roughnessRadius = mix(sqrt(mat.roughness), 1., 0.5 * (1. - mat.metalness));

  vec4 random = blueNoise();
  float r = radius * roughnessRadius * sqrt(random.r) * exp(-maxAlpha * 0.01);

  // rotate the poisson disk
  float angle = random.g * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rm = mat2(c, -s, s, c) * r;

  for (int i = 0; i < 8; i++) {
    vec2 offset = rm * poissonDisk[i];
    vec2 neighborUv = vUv + offset;

    Neighbor[textureCount] neighbors;
    getNeighborWeight(inputs, neighbors, neighborUv);

    for (int j = 0; j < textureCount; j++)
      evaluateNeighbor(inputs[j], neighbors[j]);
  }

  outputTexel(gOutput0, inputs[0]);

#if textureCount == 2
  outputTexel(gOutput1, inputs[1]);
#endif
}