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
float specularFactor;

struct InputTexel {
  vec3 rgb;
  float a;
  float luminance;
  float w;
  float totalWeight;
  bool isSpecular;
};

void transformColor(inout vec3 color) {}
void undoColorTransform(inout vec3 color) {}

void getNeighborWeight(inout InputTexel[textureCount] inputs, inout vec2 neighborUv) {
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

  float disocclW = sqrt(wBasic);

  for (int i = 0; i < textureCount; i++) {
    float w = 1.0;

    vec4 t;
    if (inputs[i].isSpecular) {
      t = textureLod(inputTexture2, neighborUv, 0.);
      w *= specularFactor;
    } else {
      t = textureLod(inputTexture, neighborUv, 0.);
    }

    transformColor(t.rgb);

    float lumaDiff = abs(inputs[i].luminance - luminance(t.rgb));
    float lumaFactor = exp(-lumaDiff * lumaPhi);

    w *= mix(wBasic * lumaFactor, disocclW, inputs[i].w) * inputs[i].w;

    inputs[i].rgb += w * t.rgb;
    inputs[i].totalWeight += w;
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
  undoColorTransform(inp.rgb);

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

    transformColor(t.rgb);

    // check: https://www.desmos.com/calculator/jurqfiigcf for graphs
    float age = 1. / log(exp(t.a * phi) + 1.718281828459045); // e - 1

    InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), age, 1., isTextureSpecular[i]);
    maxAlpha = max(maxAlpha, inp.a);

    inputs[i] = inp;
  }

  mat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(mat);
  glossiness = max(0., 4. * (1. - mat.roughness / 0.25));
  specularFactor = exp(-glossiness * specularPhi);

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

    getNeighborWeight(inputs, neighborUv);
  }

  outputTexel(gOutput0, inputs[0]);

#if textureCount == 2
  outputTexel(gOutput1, inputs[1]);
#endif
}