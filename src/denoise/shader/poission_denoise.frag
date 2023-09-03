varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
uniform sampler2D depthTexture;
uniform sampler2D
    depthNormalTexture; // optional, in case no gBufferTexture is used
uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float radius;
uniform float phi;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform vec2 resolution;

layout(location = 0) out vec4 gOutput0;
layout(location = 1) out vec4 gOutput1;

#include <common>
#include <gbuffer_packing>

#define luminance(a) pow(dot(vec3(0.2125, 0.7154, 0.0721), a), 0.125);

vec3 getWorldPos(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

  // Perspective division
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  worldSpacePosition.xyz /= worldSpacePosition.w;
  return worldSpacePosition.xyz;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos,
                  const vec3 worldNormal) {
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

void toDenoiseSpace(inout vec3 color) { color = log(color + 1.); }

void toLinearSpace(inout vec3 color) { color = exp(color) - 1.; }

void evaluateNeighbor(const vec4 neighborTexel, inout vec3 denoised,
                      inout float totalWeight, const float wBasic) {
  float w = min(1., wBasic);

  denoised += w * neighborTexel.rgb;
  totalWeight += w;
}

Material centerMat;
vec3 normal;
float centerDepth;
vec3 centerWorldPos;
float centerLumDiffuse;
float centerLumSpecular;
float roughnessSpecularFactor;
float w, w2;
struct Neighbor {
  vec4 texel;
  float weight;
};

Neighbor getNeighborWeight(vec2 neighborUv, bool isDiffuseGi) {
  float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).r;
  if (neighborDepth == 1.0)
    return Neighbor(vec4(0.), 0.);

  float distanceToCenter = length(vUv - neighborUv) + 1.;
  distanceToCenter = pow(distanceToCenter, 8.) - 1.;

  vec4 neighborDiffuseGi = textureLod(inputTexture, neighborUv, 0.);
  vec4 neighborSpecularGi = textureLod(inputTexture2, neighborUv, 0.);

  toDenoiseSpace(neighborDiffuseGi.rgb);
  toDenoiseSpace(neighborSpecularGi.rgb);

  float neighborLuminance = luminance(neighborDiffuseGi.rgb);
  float neighborLuminance2 = luminance(neighborSpecularGi.rgb);

#ifdef GBUFFER_TEXTURE
  Material neighborMat = getMaterial(gBufferTexture, neighborUv);
  vec3 neighborNormal = neighborMat.normal;
#else
  vec3 neighborDepthVelocityTexel =
      textureLod(depthNormalTexture, neighborUv, 0.).xyz;
  vec3 neighborNormal = unpackNormal(neighborDepthVelocityTexel.b);
#endif

  vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

  float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
  float depthDiff =
      10. * distToPlane(centerWorldPos, neighborWorldPos, centerMat.normal);

  float lumaDiff = mix(abs(centerLumDiffuse - neighborLuminance), 0., w);
  float lumaDiff2 = mix(abs(centerLumSpecular - neighborLuminance2), 0., w2);

#ifdef GBUFFER_TEXTURE
  float roughnessDiff = abs(centerMat.roughness - neighborMat.roughness);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi -
                     roughnessDiff * roughnessPhi);
#else
  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi);
#endif

  if (isDiffuseGi) {
    wBasic = mix(wBasic, exp(-normalDiff * 10.), w);
    float wDiff = w * pow(wBasic * exp(-lumaDiff * lumaPhi), phi / w);

    wDiff = min(wDiff, 1.);

    return Neighbor(neighborDiffuseGi, wDiff);
  } else {
    wBasic = mix(wBasic, exp(-normalDiff * 10.), w2);
    float wSpec = w2 * pow(wBasic * exp(-lumaDiff2 * lumaPhi), phi / w2);

    wSpec *= mix(exp(-distanceToCenter * 100. - normalDiff * 50.), w2,
                 roughnessSpecularFactor);

    wSpec = min(wSpec, 1.);

    return Neighbor(neighborSpecularGi, wSpec);
  }
}

const vec2 poissonDisk[samples] = POISSON_DISK_SAMPLES;

void main() {
  centerDepth = textureLod(depthTexture, vUv, 0.).r;

  if (centerDepth == 1.0) {
    discard;
    return;
  }

  vec4 centerDiffuseGi = textureLod(inputTexture, vUv, 0.0);
  vec4 centerSpecularGi = textureLod(inputTexture2, vUv, 0.0);

  float a = centerDiffuseGi.a;
  float a2 = centerSpecularGi.a;

  if (a + a2 > 512.) {
    discard;
    return;
  }

  // the weights w, w2 are used to make the denoiser more aggressive the
  // younger the pixel is
  w = 1. / sqrt(a + 1.);
  w2 = 1. / sqrt(a2 + 1.);

  toDenoiseSpace(centerDiffuseGi.rgb);
  toDenoiseSpace(centerSpecularGi.rgb);

  centerLumDiffuse = luminance(centerDiffuseGi.rgb);
  centerLumSpecular = luminance(centerSpecularGi.rgb);

  centerMat = getMaterial(gBufferTexture, vUv);

#ifdef GBUFFER_TEXTURE
  normal = centerMat.normal;
#else
  vec3 depthVelocityTexel = textureLod(depthNormalTexture, vUv, 0.).xyz;
  normal = unpackNormal(depthVelocityTexel.b);
#endif

  roughnessSpecularFactor = min(1., centerMat.roughness / 0.25);
  roughnessSpecularFactor *= roughnessSpecularFactor;

  // ! todo: increase denoiser aggressiveness by distance
  // ! todo: use separate weights for diffuse and specular

  float totalWeight = 1.;
  float totalWeight2 = 1.;

  vec3 denoisedDiffuse = centerDiffuseGi.rgb * totalWeight;
  vec3 denoisedSpecular = centerSpecularGi.rgb * totalWeight2;

  centerWorldPos = getWorldPos(centerDepth, vUv);

  vec4 random = blueNoise();
  float angle = random.r * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rotationMatrix = mat2(c, -s, s, c);

  // scale the radius depending on the pixel's age
  float r = 1. + sqrt(random.a) * exp(-(a + a2) * 0.01) * radius;

  for (int i = 0; i < samples; i++) {
    vec2 offset = r * rotationMatrix * poissonDisk[i];

    vec2 neighborUv = vUv + offset;

    Neighbor neighborDiffuse = getNeighborWeight(neighborUv, true);
    Neighbor neighborSpecular = getNeighborWeight(neighborUv, false);

    evaluateNeighbor(neighborDiffuse.texel, denoisedDiffuse, totalWeight,
                     neighborDiffuse.weight);

    evaluateNeighbor(neighborSpecular.texel, denoisedSpecular, totalWeight2,
                     neighborSpecular.weight);
  }

  denoisedDiffuse /= totalWeight;
  denoisedSpecular /= totalWeight2;

  toLinearSpace(denoisedDiffuse);
  toLinearSpace(denoisedSpecular);

  gOutput0 = vec4(denoisedDiffuse, centerDiffuseGi.a);
  gOutput1 = vec4(denoisedSpecular, centerSpecularGi.a);
}