varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
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
layout(location = 1) out vec4 gOutput1;

#include <common>
#include <gbuffer_packing>

#define luminance(a) pow(dot(vec3(0.2125, 0.7154, 0.0721), a), 0.125)

Material centerMat;
vec3 normal;
float centerDepth;
vec3 centerWorldPos;
float specularFactor;
struct Neighbor {
  vec4 texel;
  float weight;
};

struct InputTexel {
  vec3 rgb;
  float a;
  float luminance;
  float w;
  float totalWeight;
  bool isSpecular;
};

vec3 getWorldPos(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

  // Perspective division
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  worldSpacePosition.xyz /= worldSpacePosition.w;
  return worldSpacePosition.xyz;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos, const vec3 worldNormal) {
  vec3 toCurrent = worldPos - neighborWorldPos;
  float distToPlane = abs(dot(toCurrent, worldNormal));

  return distToPlane;
}

vec2 viewSpaceToScreenSpace(const vec3 position) {
  vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
  projectedCoord.xy /= projectedCoord.w;
  // [-1, 1] --> [0, 1] (NDC to screen position)
  projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

  return projectedCoord.xy;
}

void toDenoiseSpace(inout vec3 color) {}

void toLinearSpace(inout vec3 color) {}

void evaluateNeighbor(inout InputTexel inp, inout Neighbor neighbor) {
  // abort here as otherwise we'd lose too much precision
  if (neighbor.weight < 0.01)
    return;

  inp.rgb += neighbor.weight * neighbor.texel.rgb;
  inp.totalWeight += neighbor.weight;
}

Neighbor[2] getNeighborWeight(inout InputTexel[2] inputs, inout vec2 neighborUv) {
  float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).r;
  if (neighborDepth == 1.0)
    return Neighbor[2](Neighbor(vec4(0.), 0.), Neighbor(vec4(0.), 0.));

#ifdef GBUFFER_TEXTURE
  Material neighborMat = getMaterial(gBufferTexture, neighborUv);
  vec3 neighborNormal = neighborMat.normal;
#else
  vec3 neighborDepthVelocityTexel = textureLod(normalTexture, neighborUv, 0.).xyz;
  vec3 neighborNormal = unpackNormal(neighborDepthVelocityTexel.b);
#endif

  vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

  float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
  float depthDiff = 10. * distToPlane(centerWorldPos, neighborWorldPos, centerMat.normal);

#ifdef GBUFFER_TEXTURE
  float roughnessDiff = abs(centerMat.roughness - neighborMat.roughness);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi);
#else
  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  float sw = exp(-normalDiff * 5.);

  bool[2] isSpecular = bool[](false, true);
  Neighbor[2] neighbors;

  for (int i = 0; i < 2; i++) {
    vec4 t;
    if (isSpecular[i]) {
      t = textureLod(inputTexture2, neighborUv, 0.);
    } else {
      t = textureLod(inputTexture, neighborUv, 0.);
    }

    toDenoiseSpace(t.rgb);

    float lumaDiff = abs(inputs[i].luminance - luminance(t.rgb));
    float lumaFactor = exp(-lumaDiff * lumaPhi * (1. - inputs[i].w));

    wBasic = mix(wBasic, sw, inputs[i].w);

    // calculate the final weight of the neighbor
    // float w = mix(wBasic, sw, inputs[i].w);
    float w = wBasic;
    w = inputs[i].w * pow(w * lumaFactor, phi / inputs[i].w);

    if (isSpecular[i])
      w *= exp(-specularFactor * specularPhi) * sw;

    neighbors[i] = Neighbor(t, w);
  }

  return neighbors;
}

vec3 getNormal(Material centerMat) {
#ifdef GBUFFER_TEXTURE
  return centerMat.normal;
#else
  vec3 depthVelocityTexel = textureLod(normalTexture, vUv, 0.).xyz;
  return unpackNormal(depthVelocityTexel.b);
#endif
}

const vec2 poissonDisk[8] = POISSON_DISK_SAMPLES;

void outputTexel(inout vec4 outputFrag, InputTexel inp) {
  inp.rgb /= inp.totalWeight;

  toLinearSpace(inp.rgb);

  outputFrag.rgb = inp.rgb;
  outputFrag.a = inp.a;
}

void main() {
  centerDepth = textureLod(depthTexture, vUv, 0.).r;

  if (centerDepth == 1.0) {
    discard;
    return;
  }

  InputTexel[2] inputs;

  for (int i = 0; i < 2; i++) {
    vec4 t;
    if (i == 0) {
      t = textureLod(inputTexture, vUv, 0.);
    } else {
      t = textureLod(inputTexture2, vUv, 0.);
    }

    InputTexel inp = InputTexel(t.rgb, t.a, luminance(t.rgb), 1. / pow(t.a + 1., 0.6), 1., i == 1);

    inputs[i] = inp;
  }

  // if (inputs[0].a + inputs[1].a > 512.) {
  //   gOutput0 = vec4(inputs[0].rgb, inputs[0].a);
  //   gOutput1 = vec4(inputs[1].rgb, inputs[1].a);

  //   return;
  // }

  // convert all values of inputs to denoise space
  for (int i = 0; i < 2; i++)
    toDenoiseSpace(inputs[i].rgb);

  centerMat = getMaterial(gBufferTexture, vUv);
  normal = getNormal(centerMat);

  specularFactor = max(0., 4. * (1. - centerMat.roughness / 0.25));

  centerWorldPos = getWorldPos(centerDepth, vUv);
  vec3 cameraPos = cameraMatrixWorld[3].xyz;
  float distanceToCamera = distance(centerWorldPos, cameraPos);

  float roughnessRadius = mix(sqrt(centerMat.roughness), 1., 0.5 * (1. - centerMat.metalness));

  vec4 random = blueNoise();
  float r = sqrt(random.a) * exp(-(inputs[0].a + inputs[1].a) * 0.01) * radius * roughnessRadius;

  // rotate the poisson disk
  float angle = random.r * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rm = mat2(c, -s, s, c);
  rm *= r * 25.0 / distanceToCamera;

  for (int i = 0; i < 8; i++) {
    vec2 offset = rm * poissonDisk[i];
    vec2 neighborUv = vUv + offset;

    Neighbor[2] neighbors = getNeighborWeight(inputs, neighborUv);

    for (int j = 0; j < 2; j++)
      evaluateNeighbor(inputs[j], neighbors[j]);
  }

  // inputs[0].rgb = vec3(specularFactor);

  outputTexel(gOutput0, inputs[0]);
  outputTexel(gOutput1, inputs[1]);
}